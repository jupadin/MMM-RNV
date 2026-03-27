/* Magic Mirror
 * Module: MMM-RNV
 *
 * By jupadin
 * MIT Licensed.
 */

Module.register("MMM-RNV",{
   // Default module config.
   defaults: {
        header: "MMM-RNV",
        animationSpeed: 2 * 1000, // 2 seconds
        updateInterval: 1 * 60 * 1000, // every 1 minute
        stationID: 2417,
        numJourneys: 10,
        coloredLines: true,
        showLineIcons: true,
        useColorForRealTimeInfo: true,
        showTableHeader: true,
        showTableHeaderAsSymbols: false,
        focus_on: [],
        showFooter: true,
        apiKey: "",
        clientID: "",
        resourceID: "",
        clientSecret: "",
        oAuthURL: "",
        tenantID: "",
        clientAPIURL: "",
        icon: {
            "STRASSENBAHN" : "fas fa-train",
            "STADTBUS" : "fas fa-bus"
        },
        timeFormat: "HH:mm",
    },
    
    // Define start sequence.
    start: function() {
        Log.info(`Starting module: ${this.name}`);

        moment.updateLocale(this.config.language, this.config.timeFormat);

        // Indicate no data available yet
        this.loaded = false;

        this.error = null;
        this.credentials = false;
        this.stationName = "";
        
        // Clear data before start
        this.fetchedData = null;
        this.fetchedColor = null;
        this.config.identifier = this.identifier;

        if ( (this.config.apiKey) || (this.config.clientID && this.config.clientSecret && this.config.tenantID && this.config.resourceID) ) {
            this.credentials = true;
            // Build oAuthURL based on given tenantID.
            this.config.oAuthURL = "https://login.microsoftonline.com/" + this.config.tenantID + "/oauth2/token";
        }
        this.sendSocketNotification("SET_CONFIG", this.config);
        
        const now = new Date();
        const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

        // Live-Minuten-Update
        setTimeout(() => {
            // Update DOM-Daten
            this.updateDom(0);
            // console.log("update UI1");

            this.minuteTimer = setInterval(() => {
                this.updateDom(0);
                // console.log("update UI2");
            }, 60 * 1000); // alle 60 Sekunden+
        }, msUntilNextMinute);

        // console.log("Time until next minute:", msUntilNextMinute);
    },
    
    // Define required styles.
    getStyles: function() {
        return['MMM-RNV.css', "font-awesome.css"];
    },
    
    // Define required scripts.
    getScripts: function() {
        return [];
    },

    // Define required translations.
    getTranslations: function() {
        return {
            de: "translations/de.json",
            en: "translations/en.json",
            fr: "translations/fr.json"
        }
    },
    
    // Define header.
    getHeader: function() {
        if (!this.loaded) {
            return this.config.header;
        } else {
            return this.config.header + " - " + this.stationName;
        }
    },

    getTemplate() {
        return "MMM-RNV.njk";
    },

    getTemplateData() {
        if (!this.loaded) {
            return {loading: this.translate("LOADING")};
        } else if (this.error) {
            return {error: this.translate("ERROR")}
        }
        
        const journeys = this.fetchedData;

        if (!this.lastFetch) {
            this.config.showFooter = false;
        }
        
        const lastUpdateMinutes = new Date(this.lastFetch).getMinutes();
        const nowMinutes = new Date().getMinutes();
        const diffMinutes = nowMinutes - lastUpdateMinutes;

        // console.log(new Date().toString("HH:mm"), lastUpdateMinutes, nowMinutes, diffMinutes)

        let updateClass;
        if (diffMinutes >= 2) updateClass = "aging";
        else if (diffMinutes >= 5) updateClass = "stale";
        else updateClass = "fresh";
        this.last_update = moment(this.lastFetch).format(this.config.timeFormat)

        return {
            loading: null,
            error: null,
            journeys: journeys,
            icons: this.config.icon,
            showHeaderAsIcon: this.config.showHeaderAsIcon,
            showFooter: this.config.showFooter,
            last_updated: this.last_update,
            minutesAgo: diffMinutes,
            updateClass: updateClass
        }
    },
    
    // Override dom generator.
    // getDom: function() {
    //     const wrapper = document.createElement("div");
        
    //     if (!this.credentials) {
    //         wrapper.innerHTML = "There are no <i>RNV Credentials</i> in config file set.";
    //         wrapper.className = "light small dimmed";
    //         return wrapper;
    //     }
    //     if (this.config.stationID == "") {
    //         wrapper.innerHTML = "No <i>stationID</i> in config file set.";
    //         wrapper.className = "light small dimmed";
    //         return wrapper;
    //     }
    //     if (!this.loaded) {
    //         wrapper.innerHTML = this.translate("LOADING");
    //         wrapper.className = "light small dimmed";
    //         return wrapper;
    //     }

    //     if (this.loaded && this.fetchedData.data.station.journeys.elements.length == 0) {
    //         wrapper.innerHTML = "No data available";
    //         wrapper.className = "light small dimmed";
    //         return wrapper;
    //     }

    //     // Create dom table
    //     const table = document.createElement("table");
    //     table.className = "table";

    //     if (this.config.showTableHeader) {
    //         const tableHead = document.createElement("tr");

    //         const tableHeadTime = document.createElement("th");
    //         tableHeadTime.className = "departure";

    //         if (this.config.showTableHeaderAsSymbols) {
    //             const tableHeadTimeIcon = document.createElement("i");
    //             tableHeadTimeIcon.classList.add("far");
    //             tableHeadTimeIcon.classList.add("fa-clock");
    //             tableHeadTime.appendChild(tableHeadTimeIcon);
    //             tableHeadTime.style.textAlign = "center";
    //         } else {
    //             tableHeadTime.style.textAlign = "left";
    //             tableHeadTime.innerHTML = this.translate("DEPARTURE");
    //         }

    //         const tableHeadLine = document.createElement("th");
    //         tableHeadLine.className = "line";
    //         tableHeadLine.colSpan = "2";
    //         if (this.config.showTableHeaderAsSymbols) {
    //             const tableHeadLineIcon = document.createElement("i");
    //             tableHeadLineIcon.className ="fa fa-tag";
    //             tableHeadLine.appendChild(tableHeadLineIcon);
    //         } else {
    //             tableHeadLine.innerHTML = this.translate("LINE");
    //         }
            
    //         const tableHeadDestination = document.createElement("th");
    //         tableHeadDestination.className = "direction";
    //         if (this.config.showTableHeaderAsSymbols) {
    //             const tableHeadDestinationIcon = document.createElement("i");
    //             tableHeadDestinationIcon.className = "fa fa-arrows-alt-h";
    //             tableHeadDestination.appendChild(tableHeadDestinationIcon);
    //         } else {
    //             tableHeadDestination.innerHTML = this.translate("DIRECTION");
    //         }
            
    //         const tableHeadPlatform = document.createElement("th");
    //         tableHeadPlatform.className = "platform";
    //         if (this.config.showTableHeaderAsSymbols) {
    //             const tableHeadPlatformIcon = document.createElement("i");
    //             tableHeadPlatformIcon.className = "fa fa-question";
    //             tableHeadPlatform.appendChild(tableHeadPlatformIcon);
    //         } else {
    //             tableHeadPlatform.innerHTML = this.translate("PLATFORM");
    //         }
            
    //         tableHead.appendChild(tableHeadTime);
    //         tableHead.appendChild(tableHeadLine);
    //         tableHead.appendChild(tableHeadDestination);
    //         tableHead.appendChild(tableHeadPlatform);

    //         table.appendChild(tableHead);

    //         // Horizontal rule after table header
    //         const hruleRow = document.createElement("tr");
    //         const hruleData = document.createElement("td");
    //         hruleData.colSpan = 5;
    //         hruleData.innerHTML = "<hr>";

    //         hruleRow.appendChild(hruleData);
    //         table.appendChild(hruleRow);
    //     }

    //     const numDepartures = this.fetchedData.data.station.journeys.elements.length;
    //     // Iterating over received data
    //     for (let i = 0; i < numDepartures; i++) {

    //         const dataRow = document.createElement("tr");

    //         const currentDeparture  = this.fetchedData.data.station.journeys.elements[i];
    //         const line = currentDeparture.line.id.split("-")[1];
    //         const type = currentDeparture.type;

    //         const destination = currentDeparture.stops[0].destinationLabel;
    //         const platform = currentDeparture.stops[0].pole.platform.label;
    //         const delay = currentDeparture.stops[0].delay;

    //         const departureTimes = currentDeparture.stops[0];
    //         const plannedDepartureIsoString = departureTimes.plannedDeparture.isoString;
    //         const plannedDepartureDate = new Date(plannedDepartureIsoString);
    //         const plannedDeparture = plannedDepartureDate.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit', hour12: false});

    //         // Time
    //         const dataCellTime = document.createElement("td");
    //         dataCellTime.className = "departure";
    //         dataCellTime.innerHTML = plannedDeparture;

    //         // - Delay
    //         const dataCellTimeDelay = document.createElement("span");
    //         dataCellTimeDelay.className = "delay";
    //         if (delay > 0) {
    //             dataCellTimeDelay.innerHTML = "+ " + delay;
    //             dataCellTimeDelay.classList.add("late");
    //             if (this.config.useColorForRealTimeInfo) {
    //                 dataCellTimeDelay.style.color = "#FF0000";
    //             }
    //         } else if (delay < 0) {
    //             dataCellTimeDelay.innerHTML = "- " + delay;
    //             dataCellTimeDelay.classList.add("early");
    //             if (this.config.useColorForRealTimeInfo) {
    //                 dataCellTimeDelay.style.color = "#00FF00";
    //             }
    //         } else {
    //             dataCellTimeDelay.innerHTML = "+ " + delay;
    //             dataCellTimeDelay.style.visibility = "hidden";
    //         }
    //         // Add delay to time cell
    //         dataCellTime.appendChild(dataCellTimeDelay);

    //         dataRow.appendChild(dataCellTime);
            
    //         // Line
    //         const dataCellLine = document.createElement("td");
    //         dataCellLine.className = "line";

    //         const dataCellLineContent = document.createElement("div");
    //         dataCellLineContent.className = "content";
    //         dataCellLineContent.innerHTML = line;

    //         if (this.config.coloredLines) {
    //             if (this.fetchedColor !== null && this.fetchedColor !== undefined) {                
    //                 const colorData = this.fetchedColor.find(x => x.id == line);
    //                 if (colorData !== undefined) {
    //                     dataCellLineContent.style.backgroundColor = colorData.primary.hex;;
    //                 } else {
    //                     dataCellLineContent.style.backgroundColor = "grey";
    //                 }
    //             }
    //         }

    //         dataCellLine.appendChild(dataCellLineContent);

    //         if (type === "STRASSENBAHN") {
    //             dataCellLineContent.classList.add("train");
    //         } else if (type ==="STADTBUS") {
    //             dataCellLineContent.classList.add("bus");
    //             dataCellLineContent.style.borderRadius = "50%";
    //         }
    //         dataRow.appendChild(dataCellLine);
            
    //         // Icon
    //         const dataCellLineSpan = document.createElement("td");
    //         dataCellLineSpan.className = "icon";
    //         if (this.config.showLineIcons) {
    //             const dataCellLineIcon = document.createElement("i");
    //             dataCellLineIcon.className = this.config.icon[type];
    //             dataCellLineSpan.appendChild(dataCellLineIcon);
    //         }
    //         dataRow.appendChild(dataCellLineSpan);

    //         // Direction
    //         const dataCellDirection = document.createElement("td");
    //         dataCellDirection.className = "direction";
    //         dataCellDirection.innerHTML = destination;
    //         dataRow.appendChild(dataCellDirection);

    //         // Platform
    //         const dataCellPlatform = document.createElement("td");
    //         dataCellPlatform.className = "platform";
    //         dataCellPlatform.innerHTML = platform;
    //         dataRow.appendChild(dataCellPlatform);

    //         if (Array.isArray(this.config.focus_on)) {
    //             this.config.focus_on.forEach(element => {
    //                 if (element == line) {
    //                     dataRow.classList.add("bright");
    //                 }
    //             });
    //         }
            
    //         // Append data row to table.
    //         table.appendChild(dataRow);
    //     }


    //     // Create footer row with last update time.
    //     const footerRow = document.createElement("tr");
    //     footerRow.className = "footerRow";

    //     const footer = document.createElement("td");
    //     footer.className = "footer";
    //     footer.setAttribute("colspan", 8);
    //     footer.innerHTML = this.translate("UPDATED") + ": " + moment().format("dd, DD.MM.YYYY, HH:mm[h]");
    //     footerRow.appendChild(footer);

    //     table.appendChild(footerRow);


        
    //     wrapper.appendChild(table);

    //     // Return the wrapper to the dom.
    //     return wrapper;
    // },
    
    // Override socket notification handler.
    socketNotificationReceived: function(notification, payload) {
        // console.log(payload.id, notification, payload.data, payload);
        // If this message isn't for me...
        // Since we could have the module deployed multiple times, I want to process only the message which is for me.
        if (this.identifier !== payload.id) {
            return;
        }
        let animationSpeed = this.config.animationSpeed;

        if (notification === "DATA") {
            if (this.loaded) {
                animationSpeed = 0;
            }

            this.fetchedData = payload.data;
    
            // Set station name of current fetch
            this.stationName = payload.stationName;

            this.lastFetch = payload.lastFetch;

            this.loaded = true;

            // Update dom with given animation speed.
            this.updateDom(animationSpeed);

        // } else if (notification === "COLOR") {
        //     this.fetchedColor = payload.data;
        //     // // If there is already data available, update dom with fetched color data.
        //     // if (this.config.fetchedData != null) {
        //     //     // Use default animation speed to update dom with color data
        //     this.updateDom(animationSpeed);
        //     // }
        } else if (notification === "ERROR") {
            // TODO: Update front-end to display specific error.
            this.error = true;
            this.fetchedData = payload;
            this.updateDom(animationSpeed);
        } else {
            // TODO: Update front-end to display specific error.
            this.error = true;
            this.fetchedData = payload;
            this.updateDom(animationSpeed);
        }
    }
});
