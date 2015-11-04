var http = require('http');
var url = require('url');
var q = require('q');
var angularWaits = require('./angular/wait.js');


var WAIT_FOR_ANGULAR_DATA = JSON.stringify({
  script: 'return (' + angularWaits.NG_WAIT_FN + ').apply(null, arguments);',
  args: []
});

/**
 * The stability proxy is an http server responsible for intercepting
 * JSON webdriver commands. It keeps track of whether the page under test
 * needs to wait for page stability, and initiates a wait if so.
 * 
 * @constructor
 *
 * TODO: Use ES6, move to class.
 */
var StabilityProxy = function() {
  this.seleniumAddress = 'http://localhost:4444/wd/hub';
  this.stabilityEnabled = true;
  this.server = http.createServer(this.requestListener.bind(this));
};

/**
 * This command is for the proxy server, not to be forwarded to Selenium.
 */
StabilityProxy.isProxyCommand = function(commandPath) {
  return (commandPath.split('/')[1] === 'stabilize_proxy');
};

/**
 * Create the WebDriver protocol URL for the executeAsync command.
 *
 * @param {string} originalUrl The URL from the incoming command.
 */
StabilityProxy.executeAsyncUrl = function(originalUrl) {
  var parts = originalUrl.split('/');
  return [parts[0], parts[1], parts[2], 'execute_async'].join('/');
};

/**
 * Return true if the requested method should trigger a stabilize first.
 *
 * @param {string} commandPath Original request url.
 */
StabilityProxy.prototype.shouldStabilize = function(commandPath) {
  if (!this.stabilityEnabled) {
    return false;
  }

  if (StabilityProxy.isProxyCommand(commandPath)) {
    return false;
  }

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
 * Creates a request to forward to the Selenium server. The request stream will
 * not be ended - the user will need to write any data and then call `.end`.
 *
 * @param {string} method
 * @param {string} messageUrl
 * @param {function(http.IncomingMessage)} callback
 *
 * @return {http.ClientRequest}
 */
StabilityProxy.prototype.createSeleniumRequest = function(method, messageUrl, callback) {
  var parsedUrl = url.parse(this.seleniumAddress);
  var options = {};
  options.method = method;
  options.path = parsedUrl.path + messageUrl;
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

StabilityProxy.prototype.sendRequestToStabilize = function(originalRequest) {
  var self = this;
  var deferred = q.defer();
  console.log('Waiting for stability...');
  
  var stabilityRequest = self.createSeleniumRequest(
      'POST',
      StabilityProxy.executeAsyncUrl(originalRequest.url),
      function(stabilityResponse) {
        // TODO - If the response is that angular is not available on the page, should we
        // just go ahead and continue?
        stabilityData = '';
        stabilityResponse.on('data', function(data) {
          stabilityData += data;
        });

        stabilityResponse.on('error', function(err) {
          console.log(err);
          deferred.reject(err);
        });

        stabilityResponse.on('end', function() {
          var value = JSON.parse(stabilityData).value;
          if (value) {
            // waitForAngular only returns a value if there was an error
            // in the browser.
            value = 'Error while waiting for page to stabilize: ' + value;
            console.log(value);
            deferred.reject(value);
            return;
          }
          console.log('Stabilized');
          deferred.resolve();
        });
      });
  stabilityRequest.write(WAIT_FOR_ANGULAR_DATA);
  stabilityRequest.end();

  return deferred.promise;
}

StabilityProxy.prototype.requestListener = function(originalRequest, response) {
  var self = this;
  var stabilized = q(null);

  if (StabilityProxy.isProxyCommand(originalRequest.url)) {
    self.handleProxyCommand(originalRequest, response);
    return;
  }

  // If the command is not a proxy command, it's a regular webdriver command.
  console.log(originalRequest.url);

  if (self.shouldStabilize(originalRequest.url)) {
    stabilized = self.sendRequestToStabilize(originalRequest);
  }

  stabilized.then(function() {
    var seleniumRequest = self.createSeleniumRequest(
        originalRequest.method,
        originalRequest.url,
        function(seleniumResponse) {
          response.writeHead(seleniumResponse.statusCode, seleniumResponse.headers);
          seleniumResponse.pipe(response);
        });
    originalRequest.pipe(seleniumRequest);
  }, function(err) {
    response.writeHead(500);
    response.write(err);
    response.end();
  });
};

StabilityProxy.prototype.listen = function(port) {
  console.log('Stability proxy listening on port ' + port);
  this.server.listen(port);
};

exports.StabilityProxy = StabilityProxy;
