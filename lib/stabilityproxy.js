var http = require('http');
var url = require('url');
var q = require('q');
var angularWaits = require('./angular/wait.js');


var WAIT_FOR_ANGULAR_DATA = JSON.stringify({
  script: 'return (' + WAIT_FOR_ANGULAR_FUNCTION + ').apply(null, arguments);',
  args: []
});

/**
 * The stability proxy is an http server responsible for intercepting
 * JSON webdriver commands. It keeps track of whether the page under test
 * needs to wait for page stability, and initiates a wait if so.
 * 
 * @constructor
 *
 * TODO: Use ES6, move to class?
 */
var StabilityProxy = function() {
  this.seleniumAddress = 'http://localhost:4444/wd/hub';
  this.stabilityEnabled = true;
  this.server = http.createServer(this.requestListener);
};

StabilityProxy.isProxyCommand = function(commandPath) {
  return (commandPath.split('/')[1] === 'stabilize_proxy');
};

StabilityProxy.executeAsyncUrl = function(originalUrl) {
  var parts = originalUrl.split('/');
  return [parts[0], parts[1], parts[2], 'execute_async'].join('/');
};

/**
 * Return true if the requested method should trigger a stabilize first.
 */
StabilityProxy.prototype.shouldStabilize = function(commandPath) {
  if (!this.stabilityEnabled) {
    return false;
  }

  if (StabilityProxy.isProxyCommand(commandPath)) {
    return false;
  };

  // TODO - should this implement some state, and be smart about whether
  // stabilization is necessary or not? Would that be as simple as GET/POST?
  // e.g. two gets in a row don't require a wait btwn.
  //
  // See https://code.google.com/p/selenium/wiki/JsonWireProtocol for
  // descriptions of the paths.
  // We shouldn't stabilize if we haven't loaded the page yet.
  var parts = commandPath.split('/');
  if (parts.length < 4) {
    return false;
  }

  var commandsToWaitFor = [
    'execute',
    'execute_async',
    'screenshot',
    'source',
    'title',
    'element',
    'elements',
    'keys',
    'moveto',
    'click',
    'buttondown',
    'buttonup',
    'doubleclick',
    'touch'
  ];

  if (commandsToWaitFor.indexOf(parts[3]) != -1) {
    return true;
  }
  return false;
};

/**
 * Creates a request to forward to the Selenium server. The request will
 * not be ended - the user will need to call `.end`.
 *
 * @param {string} method
 * @param {string} url
 * @param {Buffer|string} data
 * @param {function(http.IncomingMessage)} callback
 * @param {function(Error)} errback
 *
 * @return {http.ClientRequest}
 */
StabilityProxy.prototype.createSeleniumRequest =
    function(method, url, callback) {
  var parsedUrl = url.parse(this.seleniumAddress);
  var options = {};
  options.method = method;
  options.path = parsedUrl.path + url;
  options.hostname = parsedUrl.hostname;
  options.port = parsedUrl.port;

  var request = http.request(options, callback);

  return request;
};

StabilityProxy.prototype.handleProxyCommand =
    function(message, data, response) {
  var command = message.url.split('/')[2];
  switch (command) {
    case 'enabled':
      if (message.method === 'GET') {
        
      } else if (message.method === 'POST') {

      } else {
        response.writeHead(405);
        response.write('Invalid method');
        response.end();
      }
      break;
    case 'selenium_address':
      if (message.method === 'GET') {
        response.writeHead(200);
        response.write(JSON.stringify({value: this.seleniumAddress}));
        response.end();
      } else if (message.method === 'POST') {
        response.writeHead(200);
        seleniumAddress = JSON.parse(data).value;
        response.end();
      } else {
        response.writeHead(405);
        response.write('Invalid method');
        response.end();
      }
      break;
    default:
      response.writeHead(404);
      response.write('Unknown stabilizer proxy command');
      response.end();
  }
};

StabilityProxy.prototype.requestListener = function(request, response) {
  var self = this;
  var stabilized = q(null);

  if (StabilityProxy.isProxyCommand(request.url)) {
    self.handleProxyCommand(request, response);
    return;
  }

  // If the command is not a proxy command, it's a regular webdriver command.

  var originalSeleniumCommandRequest = self.createSeleniumRequest(
      request.method,
      request.url,
      function(seleniumResponse) {
        // seleniumResponse is a http.IncomingMessage
        response.writeHead(seleniumResponse.statusCode, seleniumResponse.headers);
        seleniumResponse.pipe(response);
      });

  request.pipe(originalSeleniumCommandRequest, {end: false});

  if (self.shouldStabilize(request.url)) {
    var deferred = q.defer();
    stabilized = deferred.promise;
    var stabilityRequest = self.createSeleniumRequest(
        'POST',
        StabilityProxy.executeAsyncUrl(request.url),
        function(stabilizeResponse) {
          // TODO - If the response is that angular is not available on the page, should we
          // just go ahead and continue?
          stabilizeData = '';
          stabilizeResponse.on('data', function(data) {
            stabilizeData += data;
          });

          stabilizeResponse.on('error', function(err) {
            deferred.reject(err);
          });

          stabilizeResponse.on('end', function() {
            var value = JSON.parse(stabilizeData).value;
            if (value) {
              // waitForAngular only returns a value if there was an error
              // in the browser.
              value = 'Error while waiting for page to stabilize: ' + value;
              deferred.reject(value);
            }
            deferred.resolve();
          });
        });
    stabilityRequest.write(WAIT_FOR_ANGULAR_DATA);
    stabilityRequest.end();
  }

  request.on('end', function() {
    // If we should have stabilized, wait for that before forwarding request.
    stabilized.then(function() {
      originalSeleniumCommandRequest.end();
    }, function(err) {
      response.writeHead(500);
      response.write(err);
      response.end();
    });
  });
};

StabilityProxy.prototype.listen = function(port) {
  this.server.listen(port);
};

exports.StabilityProxy = StabilityProxy;
