/* Magic Mirror
 * Module: MMM-RNV
 *
 * By jupadin
 * MIT Licensed.
 */

const NodeHelper = require('node_helper');

const { ApolloClient } = require('apollo-client');
const { InMemoryCache } = require('apollo-cache-inmemory');
const { HttpLink } = require('apollo-link-http');
const { setContext } = require('apollo-link-context');

const gql = require('graphql-tag');

const Log = require('logger');

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const THIRTY_MINUTES = 30 * 60 * 1000;
const MAX_SERVER_BACKOFF = 3;


class Fetcher {
    constructor(client, url, reloadInterval, numJourneys, stationID, identifier) {
        this.client = client;
        this.url = url;
        this.reloadInterval = reloadInterval;
        this.numJourneys = numJourneys;
        this.stationID = stationID;
        this.identifier = identifier;

        this.data;
        this.color;
        this.reloadTimer = null;
        this.serverErrorCount = 0;
        this.lastFetch = null;
        this.fetchFailedCallback = () => {};
        this.dataReceivedCallback = () => {};
    }

    /**
	 * Clears any pending reload timer
	 */
	clearReloadTimer () {
		if (this.reloadTimer) {
			clearTimeout(this.reloadTimer);
			this.reloadTimer = null;
		}
	}

	/**
	 * Schedules the next fetch respecting MagicMirror test mode
	 * @param {number} delay - Delay in milliseconds
	 */
	scheduleNextFetch (delay) {
		const nextDelay = Math.max(delay || this.reloadInterval, this.reloadInterval);
		if (process.env.mmTestMode === "true") {
			return;
		}
		this.reloadTimer = setTimeout(() => this.fetchData(), nextDelay);
	}

    /**
	 * Parses the Retry-After header value
	 * @param {string} retryAfter - The Retry-After header value
	 * @returns {number|null} Milliseconds to wait or null if parsing failed
	 */
	parseRetryAfter (retryAfter) {
		const seconds = Number(retryAfter);
		if (!Number.isNaN(seconds) && seconds >= 0) {
			return seconds * 1000;
		}

		const retryDate = Date.parse(retryAfter);
		if (!Number.isNaN(retryDate)) {
			return Math.max(0, retryDate - Date.now());
		}

		return null;
	}

	/**
	 * Determines the retry delay for a non-ok response
	 * @param {Error} error - The error object
	 * @returns { {delay: number, error: Error} } Error describing the issue and computed retry delay
	 */
	getDelayForError (error) {
		let delay = this.reloadInterval;
        let status = error?.networkError?.statusCode ?? 0;

		if (status === 401 || status === 403) {
			delay = Math.max(this.reloadInterval * 5, THIRTY_MINUTES);
			Log.error(`${this.url} - Authentication failed (${status}). Waiting ${Math.round(delay / 60000)} minutes before retry.`);

		} else if (status === 429) {
			const retryAfter = response.headers.get("retry-after");
			const parsed = retryAfter ? this.parseRetryAfter(retryAfter) : null;
			delay = parsed !== null ? Math.max(parsed, this.reloadInterval) : Math.max(this.reloadInterval * 2, FIFTEEN_MINUTES);
			Log.warn(`${this.url} - Rate limited (429). Retrying in ${Math.round(delay / 60000)} minutes.`);

		} else if (status >= 500) {
			this.serverErrorCount = Math.min(this.serverErrorCount + 1, MAX_SERVER_BACKOFF);
			delay = this.reloadInterval * Math.pow(2, this.serverErrorCount);
			Log.error(`${this.url} - Server error (${status}). Retry #${this.serverErrorCount} in ${Math.round(delay / 60000)} minutes.`);

		} else if (status >= 400) {
			delay = Math.max(this.reloadInterval * 2, FIFTEEN_MINUTES);
			Log.error(`${this.url} - Client error (${status}). Retrying in ${Math.round(delay / 60000)} minutes.`);
		} else {
			Log.error(`${this.url} - GraphQL request failed: ${status}.`);
		}

		return delay
	}

    /**
	 * Check if enough time has passed since the last fetch to warrant a new one.
	 * Uses reloadInterval as the threshold to respect user's configured fetchInterval.
	 * @returns {boolean} True if a new fetch should be performed
	 */
	shouldRefetch () {
		if (!this.lastFetch) {
			return true;
		}
		const timeSinceLastFetch = Date.now() - this.lastFetch;
		return timeSinceLastFetch >= this.reloadInterval;
	}

    /**
     * Broadcasts the current data to listeners
     */
    broadcastData() {
        let numJourneys = 0;
        let numColors = 0;

        if (this.data?.data?.station?.journeys?.elements) numJourneys = this.data.data.station.journeys.elements.length;
        if (this.color) numColors = this.color.length

        Log.log(`Broadcasting ${numJourneys} journeys and ${numColors} color values from "${this.url}" to ${this.identifier}.`)
        this.dataReceivedCallback(this);
    }

    /**
     * Sets the callback for successful data fetches
     * @param {( fetcher: Fetcher) => void} callback - Called when data is received
     */
    onReceive (callback) {
        this.dataReceivedCallback = callback;
    }

    /**
     * Sets the callback for fetch failures
     * @param {( fetcher: Fetcher, error: Error) => void} callback - Called when a fetch fails
     */
    onError (callback) {
        this.fetchFailedCallback = callback
    }

    /**
     * Fetches and processes data
     */
    async fetchData() {
        Log.info(`Fetching data from RNV-Server for module ${this.identifier}...`);
        const now = new Date().toISOString();
        const numJourneys = this.numJourneys;
        const stationID = this.stationID;

        const query = `query {
            station(id:"${stationID}") {
                hafasID
                longName
                journeys(startTime: "${now}" first: ${numJourneys}) {
                    totalCount
                    elements {
                        ... on Journey {
                            line {
                                id
                            }
                            type
                            stops(onlyHafasID: "${stationID}") {
                                pole {
                                    platform {
                                        type
                                        label
                                        barrierFreeType
                                    }
                                }
                                destinationLabel
                                plannedArrival {
                                    isoString
                                }
                                realtimeArrival {
                                    isoString
                                }
                                plannedDeparture {
                                    isoString
                                }
                                realtimeDeparture {
                                    isoString
                                }
                            }
                        }
                    }
                }
            }
        }`;

        this.clearReloadTimer();

        let nextDelay = this.reloadInterval;
        try {
            const response = await this.client.query({ query: gql(query) });
            this.serverErrorCount = 0;
            const fetchedData = response;

            // Remove elements where its depature time is equal to null
            // Iteration from end of array since the command *splice* might reduce its size.
            for (let i = fetchedData.data.station.journeys.elements.length - 1; i >= 0; i--) {
                if (fetchedData.data.station.journeys.elements[i].stops[0].plannedDeparture.isoString == null) {
                    fetchedData.data.station.journeys.elements.splice(i, 1);
                }
            }

            // Sorting fetched data based on the departure times
            fetchedData.data.station.journeys.elements.sort((a, b) => {
                let depA = a.stops[0].plannedDeparture.isoString;
                let depB = b.stops[0].plannedDeparture.isoString;
                return (depA < depB) ? -1 : ((depA > depB) ? 1 : 0);
            });

            const numDepartures = fetchedData.data.station.journeys.elements.length;
            const delayFactor = 60 * 1000;

            // Delay
            for (let i = 0; i < numDepartures; i++) {
                // Create new key-value pair, representing the current delay of the departure
                fetchedData.data.station.journeys.elements[i].stops[0].delay = 0;
                // If there is no realtime departure data avaialble, skip delay calculation and continue with next departure
                if (fetchedData.data.station.journeys.elements[i].stops[0].realtimeDeparture.isoString == null) {
                    continue;
                }
                
                let currentDepartureTimes = fetchedData.data.station.journeys.elements[i].stops[0];
                // Planned Departure
                let plannedDepartureIsoString = currentDepartureTimes.plannedDeparture.isoString;
                let plannedDepartureDate = new Date(plannedDepartureIsoString);
                // Realtime Departure
                let realtimeDepartureIsoString = currentDepartureTimes.realtimeDeparture.isoString;
                let realtimeDepartureDate = new Date(realtimeDepartureIsoString);
                // Delay calculation
                let delayms = Math.abs(plannedDepartureDate - realtimeDepartureDate);
                let delay = Math.floor(delayms / delayFactor);

                // Assign calculated delay to new introduced key-value pair
                fetchedData.data.station.journeys.elements[i].stops[0].delay = delay;
            }

            // Set flag to check whether a previous fetch was successful
            this.previousFetchOk = true;
            this.lastFetch = Date.now();

            this.data = fetchedData;
            this.broadcastData()
        } catch (error) {
            Log.info("THIS", error);
            const delay = this.getDelayForError(error);
            nextDelay = delay;
            this.fetchFailedCallback(this, error);
        }
        this.scheduleNextFetch(nextDelay);
    }

    async fetchColor() {
        Log.info(`Fetching color from RNV-Server for module ${this.identifier}...`);

        const url = "https://rnvopendataportalpublic.blob.core.windows.net/public/openDataPortal/liniengruppen-farben.json";

        try {
            const response = await fetch(url);

            if (response.status != 200) {
                Log.error("ERROR")
                throw new Error(`Could not fetch color data from RNV-Server with status code ${response.status}.`)
            }
            const data = await response.json();
            this.color = data.lineGroups;

        } catch(error) {
            Log.error(`ABC: ${error}`);
        }
    }
}


module.exports = NodeHelper.create({
    start: function() {
        this.config = null;
        this.client = null;
        this.previousFetchOk = false;
        this.colorTimer = null;
        this.dataTimer = null;

        this.fetchers = [];
    },

    socketNotificationReceived: async function(notification, payload) {
        if (notification == "SET_CONFIG") {
            let apiKey;
            const clientAPIURL = payload.clientAPIURL;

            if (!payload.apiKey) {
                const clientID = payload.clientID;
                const clientSecret = payload.clientSecret;
                const resourceID = payload.resourceID;
                const oAuthURL = payload.oAuthURL;

                // Create apiKey from given credentials
                apiKey = await this.createToken(oAuthURL, clientID, clientSecret, resourceID);
            }

            // Authenticate by OAuth
            this.client = this.authenticate(apiKey, clientAPIURL);

            this.getOrCreateFetcher(this.client, payload.clientAPIURL, payload.identifier, payload.updateInterval, payload.numJourneys, payload.stationID);
        }
    },

    getOrCreateFetcher: function(client, url, identifier, fetchInterval, numJourneys, stationID) {
        try {
            new URL(url);
        } catch (error) {
            Log.error(`Malformed API-URL (${url}): ${error}`)
            this.sendSocketNotification("ERROR", error);
            return;
        }

        let fetcher = null;
        let fetchIntervalCorrected;

        if (typeof this.fetchers[identifier + url] === "undefined") {
            if (fetchInterval < 60 * 1000) {
                Log.warn(`fetchInterval for url ${url} must be >= 60.000`)
                fetchIntervalCorrected = 60000;
            }
            Log.log(`Create new fetcher for url "${url}" and "${identifier}" - Interval: ${fetchIntervalCorrected || fetchInterval}`);
            fetcher = new Fetcher(client, url, fetchIntervalCorrected || fetchInterval, numJourneys, stationID, identifier);

            // Log.log(`Setting callback function of fetcher ${fetcher.identifier} for *onReceive*.`)
            fetcher.onReceive((fetcher) => {
                this.broadcastData(fetcher, identifier);
            })

            // Log.log(`Setting callback function of fetcher ${fetcher.identifier} for *onError*.`)
            fetcher.onError((fetcher, error) => {
                Log.error(`Fetcher error - Could not fetch data for module ${fetcher.identifier}: ${error}`)
                //let errorType = NodeHelper.checkFetchError(error);
                this.sendSocketNotification("ERROR", 4);
            })

            this.fetchers[identifier + url] = fetcher;
            fetcher.fetchData();
            fetcher.fetchColor();
        } else {
            Log.log(`Use existing fetcher for url ${url} and identifier ${identifier}`)
            fetcher = this.fetchers[identifier + url];

            // Check if data is stale and needs refresh
            if (fetcher.shouldRefetch()) {
                Log.log(`Data is stale, fetching fresh data for url ${url}`)
                fetcher.fetchData();
            } else {
                fetcher.broadcastData();
            }
        }
    },

    // Create access token if there is none given in the configuration file
    createToken: async function(OAUTH_URL, CLIENT_ID, CLIENT_SECRET, RESOURCE_ID) {
        const response = await fetch(OAUTH_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: 'grant_type=client_credentials&client_id=' + CLIENT_ID + '&client_secret=' + CLIENT_SECRET + '&resource=' + RESOURCE_ID 
        });
        
        if (!response.ok) {
            Log.error(`${this.name}: Error while creating access token:  ${response.error}`);
            return null;
        }
        const json = await response.json();
        return json["access_token"];
    },
    
    // Authenticate with given token
    authenticate: function(token, clientAPIURL) {        
        var httpLink = new HttpLink({uri: clientAPIURL, credentials: 'same-origin', fetch: fetch});
        
        var middlewareAuthLink = setContext(async (_, { headers }) => {
            return {
                headers: {
                    ...headers,
                    authorization: token ? `Bearer ${token}` : null,
                },
            };
        });
        
        var client = new ApolloClient({
            link: middlewareAuthLink.concat(httpLink),
            cache: new InMemoryCache()
        })
        return client;
    },

    /**
     * Broadcasts the current data to listeners
     */
    broadcastData(fetcher, identifier) {
        if (fetcher.data) this.sendSocketNotification("DATA", {id: identifier, data: fetcher.data});
        if (fetcher.color) this.sendSocketNotification("COLOR", {id: identifier, data: fetcher.color});
    }
});