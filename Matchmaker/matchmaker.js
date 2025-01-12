// Copyright Epic Games, Inc. All Rights Reserved.
var enableRedirectionLinks = false;
var enableRESTAPI = true;

const defaultConfig = {
	// The port clients connect to the matchmaking service over HTTP
	HttpPort: 90,
	HttpsPort: 443,
	UseHTTPS: true,
	// The matchmaking port the signaling service connects to the matchmaker
	MatchmakerPort: 9999,

	// Log to file
	LogToFile: true
};

// Similar to the Signaling Server (SS) code, load in a config.json file for the MM parameters
const argv = require('yargs').argv;

var configFile = (typeof argv.configFile != 'undefined') ? argv.configFile.toString() : 'config.json';
console.log(`configFile ${configFile}`);
const config = require('./modules/config.js').init(configFile, defaultConfig);
console.log("Config: " + JSON.stringify(config, null, '\t'));

const express = require('express');
var cors = require('cors');
const app = express();
const http = require('http').Server(app);
const fs = require('fs');
const path = require('path');
const logging = require('./modules/logging.js');
logging.RegisterConsoleLogger();

if (config.LogToFile) {
	logging.RegisterFileLogger('./logs');
}

// A list of all the Cirrus server which are connected to the Matchmaker.
var cirrusServers = new Map();

//
// Parse command line.
//

if (typeof argv.HttpPort != 'undefined') {
	config.HttpPort = argv.HttpPort;
}
if (typeof argv.MatchmakerPort != 'undefined') {
	config.MatchmakerPort = argv.MatchmakerPort;
}

http.listen(config.HttpPort, () => {
    console.log('HTTP listening on *:' + config.HttpPort);
});


if (config.UseHTTPS) {
	//HTTPS certificate details
	const options = {
		key: fs.readFileSync(path.join(__dirname, './certificates/client-key.pem')),
		cert: fs.readFileSync(path.join(__dirname, './certificates/client-cert.pem'))
	};

	var https = require('https').Server(options, app);
	// TODO: inject root-cas-cert?

	//Setup http -> https redirect
	console.log('Redirecting http->https');
	app.use(function (req, res, next) {
		if (!req.secure) {
			if (req.get('Host')) {
				var hostAddressParts = req.get('Host').split(':');
				var hostAddress = hostAddressParts[0];
				if (config.HttpsPort != 443) {
					hostAddress = `${hostAddress}:${config.HttpsPort}`;
				}
				return res.redirect(['https://', hostAddress, req.originalUrl].join(''));
			} else {
				console.error(`unable to get host name from header. Requestor ${req.ip}, url path: '${req.originalUrl}', available headers ${JSON.stringify(req.headers)}`);
				return res.status(400).send('Bad Request');
			}
		}
		next();
	});

	https.listen(443, function () {
		console.log('Https listening on 443');
	});
}

// No servers are available so send some simple JavaScript to the client to make
// it retry after a short period of time.
function sendRetryResponse(res) {
	res.send(`All ${cirrusServers.size} servers are in use. Retrying in <span id="countdown">3</span> seconds.
	<script>
		var countdown = document.getElementById("countdown").textContent;
		setInterval(function() {
			countdown--;
			if (countdown == 0) {
				window.location.reload(1);
			} else {
				document.getElementById("countdown").textContent = countdown;
			}
		}, 1000);
	</script>`);
}

// Get a Cirrus server if there is one available which has no clients connected.
function getAvailableCirrusServer() {
	for (cirrusServer of cirrusServers.values()) {
		if (cirrusServer.numConnectedClients === 0 && cirrusServer.ready === true) {

			// Check if we had at least 10 seconds since the last redirect, avoiding the 
			// chance of redirecting 2+ users to the same SS before they click Play.
			// In other words, give the user 10 seconds to click play button the claim the server.
			if( cirrusServer.hasOwnProperty('lastRedirect')) {
				if( ((Date.now() - cirrusServer.lastRedirect) / 1000) < 10 )
					continue;
				// Check if the last time a SS was occupied was under 1 minute ago, giving
				// a user time to reconnect to a logged in session
				if ((Date.now() - cirrusServer.lastOccupied) / 1000 < 60)
					continue;
			}
			cirrusServer.lastRedirect = Date.now();

			return cirrusServer;
		}
	}
	
	console.log('WARNING: No empty Cirrus servers are available');
	return undefined;
}

// find a Cirrus server with a matching sesion Id
function getCirrusServerBySessionId(sessionId) {
	for (cirrusServer of cirrusServers.values()) {
		if (cirrusServer.clientSessionId === sessionId)
			cirrusServer.lastRedirect = Date.now();
			return cirrusServer;
	}
	return null;
}

const getStreamUrl = (cirrusServer) => cirrusServer ? `http://${cirrusServer.address}:${cirrusServer.port}` : null;

if(enableRESTAPI) {
	// Handle REST signalling server only request.
	app.options('/signallingserver', cors())
	app.get('/signallingserver', cors(),  (req, res) => {
		const [, paramString] = req.originalUrl.split('?');
		const params =  new URLSearchParams(paramString);
		let streamUrl = null, cirrusServer;
		if (params.has('session')) {
			const sessionId = params.get('session');
			// get a server the user may still be logged in to
			cirrusServer = getCirrusServerBySessionId(sessionId);
			if (cirrusServer) {
				console.log(`Returning previously claimed server for session ${sessionId}, last occupied ${
					cirrusServer.lastOccupied ? Math.round((Date.now() - cirrusServer.lastOccupied)/1000) : 'never'
				} seconds ago`);
				streamUrl = getStreamUrl(cirrusServer);
			} else {
				// get an available server
				cirrusServer = getAvailableCirrusServer();
				if (cirrusServer) {
					if (cirrusServer.clientSessionId && cirrusServer.clientSessionId !== sessionId) {
						console.log(`New session on instance. Last occupied: ${Math.round((Date.now() - cirrusServer.lastOccupied)/1000)}
						 seconds ago by session ${cirrusServer.clientSessionId}`)
					}
					streamUrl = getStreamUrl(cirrusServer);
					console.log(`Return pending stream client session ${cirrusServer.clientSessionId} on host: ${cirrusServer.address}`);
				} else {
					res.json({ streamUrl, error: 'No signalling server available'});
					return;
				}
			}
			cirrusServer.clientSessionId = sessionId;
			cirrusServer.lastOccupied = Date.now();
			res.json({ streamUrl });
		} else {
			res.json({ streamUrl, error: 'Missing required parameter'});
		}
	});
	// Return connected cirrus instances
	app.options('/instances', cors());
	app.get('/instances', cors(), (_, res) => {
		const instances = Array.from(cirrusServers.values());
		res.send(instances);
		console.log(`Connected instances: ${JSON.stringify(instances)}`);
	});
	// Return a claimed Cirrus server (to prevent being routed to a different server on refresh)
	app.options('/session/:id', cors());
	app.get('/session/:id', cors(), (req, res) => {
		const sessionId = req.params.id;
		const cirrusServer = getCirrusServerBySessionId(sessionId);
		const streamUrl = getStreamUrl(cirrusServer);
		res.json({ streamUrl });
		console.log(`Matching Cirrus server for session ${sessionId}: ${cirrusServer.address}`);
	});

	// route to clear sessionId from instance on EXPIRE from worker
	app.options('/session/:id/expire', cors());
	app.post('/session/:id/expire', cors(), (req, res) => {
		const sessionId = req.params.id;
		const cirrusServer = getCirrusServerBySessionId(sessionId);
		if (cirrusServer) {
			console.log('Expired session ' + sessionId);
			delete cirrusServer.clientSessionId;
		}
		res.sendStatus(200);
	});
}

if(enableRedirectionLinks) {
	// Handle standard URL.
	app.get('/', (req, res) => {
		cirrusServer = getAvailableCirrusServer();
		const search = req.originalUrl.split('?')[1];
		const params = search ? `?${search}` : '';
		if (cirrusServer != undefined) {
			res.redirect(`http://${cirrusServer.address}:${cirrusServer.port}/${params}`);
			console.log(`Redirect to ${cirrusServer.address}:${cirrusServer.port}/${params}`);
		} else {
			sendRetryResponse(res);
		}
	});

	// Handle URL with custom HTML.
	app.get('/custom_html/:htmlFilename', (req, res) => {
		cirrusServer = getAvailableCirrusServer();
		if (cirrusServer != undefined) {
			res.redirect(`http://${cirrusServer.address}:${cirrusServer.port}/custom_html/${req.params.htmlFilename}`);
			console.log(`Redirect to ${cirrusServer.address}:${cirrusServer.port}`);
		} else {
			sendRetryResponse(res);
		}
	});
}

//
// Connection to Cirrus.
//

const net = require('net');

function disconnect(connection) {
	console.log(`Ending connection to remote address ${connection.remoteAddress}`);
	connection.end();
}

const matchmaker = net.createServer((connection) => {
	connection.on('data', (data) => {
		try {
			message = JSON.parse(data);

			if(message)
				console.log(`Message TYPE: ${message.type}`);
		} catch(e) {
			console.log(`ERROR (${e.toString()}): Failed to parse Cirrus information from data: ${data.toString()}`);
			disconnect(connection);
			return;
		}
		if (message.type === 'connect') {
			// A Cirrus server connects to this Matchmaker server.
			cirrusServer = {
				address: message.address,
				port: message.port,
				numConnectedClients: 0,
				lastPingReceived: Date.now()
			};
			cirrusServer.ready = message.ready === true;

			// Handles disconnects between MM and SS to not add dupes with numConnectedClients = 0 and redirect users to same SS
			// Check if player is connected and doing a reconnect. message.playerConnected is a new variable sent from the SS to
			// help track whether or not a player is already connected when a 'connect' message is sent (i.e., reconnect).
			if(message.playerConnected == true) {
				cirrusServer.numConnectedClients = 1;
			}

			// Find if we already have a ciruss server address connected to (possibly a reconnect happening)
			let server = [...cirrusServers.entries()].find(([key, val]) => val.address === cirrusServer.address && val.port === cirrusServer.port);

			// if a duplicate server with the same address isn't found -- add it to the map as an available server to send users to.
			if (!server || server.size <= 0) {
				console.log(`Adding connection for ${cirrusServer.address.split(".")[0]} with playerConnected: ${message.playerConnected}`)
				cirrusServers.set(connection, cirrusServer);
            } else {
				console.log(`RECONNECT: cirrus server address ${cirrusServer.address.split(".")[0]} already found--replacing. playerConnected: ${message.playerConnected}`)
				var foundServer = cirrusServers.get(server[0]);
				
				// Make sure to retain the numConnectedClients from the last one before the reconnect to MM
				if (foundServer) {					
					cirrusServers.set(connection, cirrusServer);
					console.log(`Replacing server with original with numConn: ${cirrusServer.numConnectedClients}`);
					cirrusServers.delete(server[0]);
				} else {
					cirrusServers.set(connection, cirrusServer);
					console.log("Connection not found in Map() -- adding a new one");
				}
			}
		} else if (message.type === 'streamerConnected') {
			// The stream connects to a Cirrus server and so is ready to be used
			cirrusServer = cirrusServers.get(connection);
			if(cirrusServer) {
				cirrusServer.ready = true;
				console.log(`Cirrus server ${cirrusServer.address}:${cirrusServer.port} ready for use`);
			} else {
				disconnect(connection);
			}
		} else if (message.type === 'streamerDisconnected') {
			// The stream connects to a Cirrus server and so is ready to be used
			cirrusServer = cirrusServers.get(connection);
			if(cirrusServer) {
				cirrusServer.ready = false;
				console.log(`Cirrus server ${cirrusServer.address}:${cirrusServer.port} no longer ready for use`);
			} else {
				disconnect(connection);
			}
		} else if (message.type === 'clientConnected') {
			// A client connects to a Cirrus server.
			cirrusServer = cirrusServers.get(connection);
			if(cirrusServer) {
				cirrusServer.numConnectedClients++;
				console.log(`Client connected to Cirrus server ${cirrusServer.address}:${cirrusServer.port}`);
			} else {
				disconnect(connection);
			}
		} else if (message.type === 'clientDisconnected') {
			// TODO: any cleanup necessary with the room?
			// A client disconnects from a Cirrus server.
			cirrusServer = cirrusServers.get(connection);
			if(cirrusServer) {
				cirrusServer.numConnectedClients--;
				console.log(`Client disconnected from Cirrus server ${cirrusServer.address}:${cirrusServer.port}`);
				if(cirrusServer.numConnectedClients === 0) {
					// this make this server immediately available for a new client
					cirrusServer.lastRedirect = 0;
				}
			} else {				
				disconnect(connection);
			}
		} else if (message.type === 'ping') { // matchmakerKeepAliveInterval
			cirrusServer = cirrusServers.get(connection);
			if(cirrusServer) {
				const now = Date.now();
				cirrusServer.lastPingReceived = now;
				if (cirrusServer.numConnectedClients > 0) {
					cirrusServer.lastOccupied = now;
				}
			} else {				
				disconnect(connection);
			}
		} else {
			console.log('ERROR: Unknown data: ' + JSON.stringify(message));
			disconnect(connection);
		}
	});

	// A Cirrus server disconnects from this Matchmaker server.
	connection.on('error', () => {
		cirrusServer = cirrusServers.get(connection);
		if(cirrusServer) {
			cirrusServers.delete(connection);
			console.log(`Cirrus server ${cirrusServer.address}:${cirrusServer.port} disconnected from Matchmaker`);
		} else {
			console.log(`Disconnected machine that wasn't a registered cirrus server, remote address: ${connection.remoteAddress}`);
		}
	});
});

matchmaker.listen(config.MatchmakerPort, () => {
	console.log('Matchmaker listening on *:' + config.MatchmakerPort);
});
