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

const Log = require('../../js/logger.js')

module.exports = NodeHelper.create({
    start: function() {
        this.config = null;
        this.client = null;
        this.previousFetchOk = false;
        this.colorTimer = null;
        this.dataTimer = null;
    },

    socketNotificationReceived: async function(notification, payload) {
        if (notification == "SET_CONFIG") {
            this.config = payload;

            clearTimeout(this.colorTimer);
            clearTimeout(this.dataTimer);

            if (!this.config.apiKey) {
                const clientID = this.config.clientID;
                const clientSecret = this.config.clientSecret;
                const resourceID = this.config.resourceID;
                const oAuthURL = this.config.oAuthURL;
                // Create apiKey from given credentials
                this.config.apiKey = await this.createToken(oAuthURL, clientID, clientSecret, resourceID);
            }

            // Authenticate by OAuth
            this.client = this.authenticate(this.config.apiKey);
        }

        // Retrieve color data from RNV-Server
        this.getColor();

        // Retrieve data from RNV-Server
        this.getData();
    },


    getColor: function() {
        Log.info(`${this.name}: Fetching color from RNV-Server...`);

        const self = this;
        const colorUrl = "https://rnvopendataportalpublic.blob.core.windows.net/public/openDataPortal/liniengruppen-farben.json";

        fetch(colorUrl, {})
        .then(response => {
            if (response.status != 200) {
                Log.debug(`${this.name}: Could not fetch color data from RNV-Server (${response.status}).`);
                Log.debug(`${this.name}: Retring to fetch color data in 30s.`);
                throw `Could not fetch color data from RNV-Server with status code ${response.status}.`
            }
            return response.json();
        })
        .then(data => {
<<<<<<< HEAD
            self.colorTimer = setTimeout(self.getColor.bind(self), 30 * 1000);
=======
            // self.colorTimer = setTimeout(self.getColor.bind(self), 30 * 1000);
>>>>>>> 7c82875d5c1668eac401fcfe4971f5fcd3c9184a
            self.sendSocketNotification("COLOR", data.lineGroups);
            return;
        })
        .catch(error => {
            Log.error(`${this.name}: ${error}.`);
        })
    },

    getData: function() {
        Log.info(`${this.name}: Fetching data from RNV-Server...`);

        const now = new Date().toISOString();
        const numJourneys = this.config.numJourneys;
        const stationID = this.config.stationID;

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

        this.client.query({ query: gql(query) }).then(fetchedData => {
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

            // Send data to front-end
            this.sendSocketNotification("DATA", fetchedData);

            // Set timeout to continuously fetch new data from RNV-Server
            this.dataTimer = setTimeout(this.getData.bind(this), (this.config.updateInterval));

        }).catch((error) => {
            // If there is "only" a apiKey given in the configuration,
            // tell the user to update the key (since it is expired).
            const clientID = this.config.clientID;
            const clientSecret = this.config.clientSecret;
            const resourceID = this.config.resourceID;
            const oAuthURL = this.config.oAuthURL;
            const previousFetchOk = this.previousFetchOk;

            if (clientID && clientSecret && oAuthURL && resourceID && previousFetchOk) {
                // Reset previousFetchOk, since there was an error (key expired (?))
                this.previousFetchOk = false;
                // Update apiKey with given credentials
                this.createToken(oAuthURL, clientID, clientSecret, resourceID).then(key => {
                    // Renew apiKey
                    this.config.apiKey = key;

                    // Renew client
                    this.client = this.authenticate(this.config.apiKey);

                    // Fetch new data from RNV-Server
                    this.getData();
                });
            } else {
                Log.debug(`${this.name} : ${error}.`);
                // Create error return value
                const errValue = 1;
                // And send socket notification back to front-end to display the / an error...
                this.sendSocketNotification("ERROR", errValue);
            }
        });
    },

    // Create access token if there is none given in the configuration file
    createToken: async function(OAUTH_URL, CLIENT_ID, CLIENT_SECRET, RESOURCE_ID) {
        const response = await fetch(OAUTH_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: 'grant_type=client_credentials&client_id=' + CLIENT_ID + '&client_secret=' + CLIENT_SECRET + '&resource=' + RESOURCE_ID 
        });
        
        if (!response.ok) {
            Log.debug(`${this.name}: Error while creating access token:  ${response.error}`);
            return null;
        }
        const json = await response.json();
        return json["access_token"];
    },
    
    // Authenticate with given token
    authenticate: function(token) {        
        var httpLink = new HttpLink({uri: this.config.clientAPIURL, credentials: 'same-origin', fetch: fetch});
        
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
    }
});
