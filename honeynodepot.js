'use strict';

var http = require('http'),
	fs = require('fs'),
	url = require('url'),
	maxmind = require('maxmind'),
    httpProxy = require('http-proxy'),
    zlib = require('zlib'),
    whois = require('node-whois'),
    //mongoose = require('mongoose'),
    progressbar = require('progress');


var HOSTMAXMINDDATA = 'geolite.maxmind.com';
var FILESMAXMINDDATA = [{path : '/download/geoip/database/GeoLiteCountry/', fileGZ : 'GeoIP.dat.gz', file : 'GeoIP.dat', tabulations : 2},
						{path : '/download/geoip/database/', fileGZ : 'GeoIPv6.dat.gz', file : 'GeoIPv6.dat',tabulations : 2},
						{path : '/download/geoip/database/', fileGZ : 'GeoLiteCity.dat.gz', file : 'GeoLiteCity.dat',tabulations : 1},
						{path : '/download/geoip/database/GeoLiteCityv6-beta/', fileGZ : 'GeoLiteCityv6.dat.gz', file : 'GeoLiteCityv6.dat', tabulations : 1},
						{path : '/download/geoip/database/asnum/', fileGZ : 'GeoIPASNum.dat.gz', file : 'GeoIPASNum.dat',tabulations : 2},
						{path : '/download/geoip/database/asnum/', fileGZ : 'GeoIPASNumv6.dat.gz', file : 'GeoIPASNumv6.dat',tabulations : 1}];
var FOLDERMAXMINDDATA = 'geoData/';

var DEBUG = true;
var GEOUPDATEDATA = false;

function HoneyNodePot(webserverURI, proxyPort, webProxy) {
	console.log('HoneyNodePot Starting...');
	var self = this;
	function httpAppsStarting() {
		self.initMaxmind();
		self.createHoneypotProxy(webserverURI, proxyPort);
		if (DEBUG) {
			self.createDebugHttpServer();
		}
	}
	if (GEOUPDATEDATA) {
		this.updateMaxmindGeodata(httpAppsStarting, webProxy);
	} else {
		httpAppsStarting();
	}
	
}

HoneyNodePot.prototype.getOriginIpInformation = function(req) {
	var ipAddress = {};
	var ipSplit = (req.headers['x-forwarded-for'] || req.connection.remoteAddress).split(':');
	ipAddress.ip = ipSplit[ipSplit.length-1];

	console.log(ipAddress.ip);
	if (ipAddress.ip !== '127.0.0.1') {
		whois.lookup(ipAddress.ip, function(err, data) {
			if (!err) {
				ipAddress.whois = data;
				console.log(data);
			} else {
				console.log(err);
			}
		});
		try {
			ipAddress.location = maxmind.getLocation(ipAddress.ip);
		} catch (e) {
			console.log(e);
		}
		
	}	
	return ipAddress;
};


HoneyNodePot.prototype.pushToDB = function(jsonData){
	var fd = fs.openSync(Date.now()+'.json', 'w');
	fs.writeSync(fd, JSON.stringify(jsonData,null,4));
	fs.closeSync(fd);
};

HoneyNodePot.prototype.getInformationsFromRequestAsJson = function(request, callback){
	var requestInformations = {};
	requestInformations.method = request.method;
	requestInformations.body = request.body;
	requestInformations.url = url.parse(request.url, true);
	requestInformations.headers = request.headers;
	requestInformations.httpVersion = request.httpVersion;
	requestInformations.origin = this.getOriginIpInformation(request);
	callback(requestInformations);
};

HoneyNodePot.prototype.updateMaxmindGeodata = function(mainCallback, webProxy) {
	console.log('Updating Geolocalisation Data...');
	var download = function(id, callback) {
		if (id < FILESMAXMINDDATA.length) {
			
			var options = {};
			if (webProxy) {
				options = {
	  				host: webProxy.host,
	  				port: webProxy.port,
					method: 'GET',
					path: 'http://'+HOSTMAXMINDDATA+FILESMAXMINDDATA[id].path + FILESMAXMINDDATA[id].fileGZ,
					headers: {
						Host: HOSTMAXMINDDATA+FILESMAXMINDDATA[id].path + FILESMAXMINDDATA[id].fileGZ
					}
				};
			} else {
				options = {
					host: HOSTMAXMINDDATA,
					port: 80,
					method: 'GET',
					path: FILESMAXMINDDATA[id].path + FILESMAXMINDDATA[id].fileGZ
				};
			}

			var buffer = [];

			var req = http.request(options);

			req.on('response', function(res){
				var tab =  new Array( FILESMAXMINDDATA[id].tabulations + 1 ).join('\t');
				if (res.statusCode === 200) {

				  	var len = parseInt(res.headers['content-length'], 10);
				  	var bar = new progressbar(' ' + FILESMAXMINDDATA[id].fileGZ + ' downloading ' + tab + ' [:bar] :percent :etas', {
				    	complete: '=',
				    	incomplete: ' ',
				    	width: 20,
				    	total: len
				  	});

			        var gunzip = zlib.createGunzip();            
			        res.pipe(gunzip);

			        gunzip.on('data', function(chunk) {
			            buffer.push(chunk.toString());
			        });
			        
			        gunzip.on('end', function() {
			            var fd = fs.openSync(FOLDERMAXMINDDATA+FILESMAXMINDDATA[id].file, 'w');
			            fs.writeSync(fd, buffer.join(''));
			            download(id+1, callback);

			        });

			        gunzip.on('error', function(e) {
			            console.log(e.message);
			        });

			        res.on('data', function(chunk) {
			            bar.tick(chunk.length);
			        });

				} else {
					console.log(' ' + FILESMAXMINDDATA[id].fileGZ + ' downloading '  + tab + ' - HTTP ERROR : ' + res.statusCode + ' ' + res.statusMessage);
				}

			});
			req.end();
		} else {
			callback();
		}
	}; 

	download(0, function () {
		console.log('Download Complete');
		mainCallback();
	});
};

HoneyNodePot.prototype.createHoneypotProxy = function (webserverURI, proxyPort) {
	console.log('Proxy Starting...');
	var proxy = httpProxy.createProxyServer({target:webserverURI}).listen(proxyPort);
	var self = this;
	proxy.on('proxyReq', function(proxyReq, req) {
		self.getInformationsFromRequestAsJson(req, self.pushToDB);
	});
};

HoneyNodePot.prototype.initMaxmind = function () {
	console.log('Initilazing Geolocalisation Data...');
	FILESMAXMINDDATA.forEach(function(element){
		maxmind.init(FOLDERMAXMINDDATA+element.file);
	});
};
HoneyNodePot.prototype.createDebugHttpServer = function () {
	console.log('Debug HTTP Server Starting...');
	http.createServer(function (req, res) {
	  res.writeHead(200, { 'Content-Type': 'text/plain' });
	  res.write('request successfully proxied!' + '\n' + JSON.stringify(req.headers, true, 2));
	  res.end();
	}).listen(9000);
};




// TODO : Replace with args To Object

// new HoneyNodePot('http://localhost:9000', 8000, {host: 'proxy.evil.corp', port: 8080});
new HoneyNodePot('http://localhost:9000', 8000);