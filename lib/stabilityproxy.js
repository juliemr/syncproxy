var http = require('http');
var url = require('url');
var q = require('q');

/**
 * Function to send to the browser to wait until Angular is stable.
 * This will be executed in the context of the browser.
 * TODO - allow changing this?
 */
var WAIT_FOR_ANGULAR_FUNCTION = function(callback) {
  var el = document.querySelector('[ng-app]');

  try {
    if (!window.angular) {
      throw new Error('angular could not be found on the window');
    }
    if (angular.getTestability) {
      angular.getTestability(el).whenStable(callback);
    } else {
      if (!angular.element(el).injector()) {
        throw new Error('root element has no injector');
      }
      angular.element(el).injector().get('$browser').
          notifyWhenNoOutstandingRequests(callback);
    }
  } catch (err) {
    callback(err.message);
  }
};

var WAIT_FOR_ANGULAR_DATA = JSON.stringify({
  script: 'return (' + WAIT_FOR_ANGULAR_FUNCTION + ').apply(null, arguments);',
  args: []
});

/**
 * @constructor
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
 * Forwards a request to the Selenium server.
 *
 * @param {string} method
 * @param {string} url
 * @param {Buffer|string} data
 * @param {function(http.IncomingMessage)} callback
 * @param {function(Error)} errback
 */
StabilityProxy.prototype.sendRequest =
    function(method, url, data, callback, errback) {
  var parsedUrl = url.parse(this.seleniumAddress);
  var options = {};
  options.method = method;
  options.path = parsedUrl.path + url;
  options.hostname = parsedUrl.hostname;
  options.port = parsedUrl.port;

  var request = http.request(options, callback);

  request.on('error', function(error) {
    errback(error);
  });

  if (data) {
    request.write(data);
  }
  request.end();
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

StabilityProxy.prototype.requestListener = function(message, response) {
  var self = this;
  var stabilized = q(null);
  var messageData;

  if (self.shouldStabilize(message.url)) {
    var deferred = q.defer();
    stabilized = deferred.promise;
    self.sendRequest('POST', StabilityProxy.executeAsyncUrl(message.url),
      WAIT_FOR_ANGULAR_DATA, function(stabilizeResponse) {
      // If the response is that angular is not available on the page, should we
      // just go ahead and continue?
      stabilizeData = '';
      stabilizeResponse.on('data', function(data) {
        // TODO - this will only work if there is only one piece of data
        stabilizeData = data;
      });

      stabilizeResponse.on('end', function() {
        var value = JSON.parse(stabilizeData).value;
        if (value) {
          // waitForAngular only returns a value if there was an error
          value = 'Error while waiting for page to stabilize: ' + value;
          response.writeHead(500);
          response.write(value);
          response.end();
          deferred.reject();
        }
        deferred.resolve();
      });
    }, function(stabilizeError) {
      response.writeHead(500);
      response.write(stabilizeError);
      response.end();
    });
  }
  
  message.on('data', function(data) {
    // TODO this will only work if there is only one piece of data
    // TODO can we do piping instead?
    messageData = data;
  });

  message.on('end', function() {
    if (isProxyCommand(message.url)) {
      self.handleProxyCommand(message, messageData, response);
    }
    // If we should have stabilized, wait for that before forwarding request.
    stabilized.then(function() {
      sendRequest(message.method, message.url, requestData, function(seleniumResponse) {
        response.writeHead(seleniumResponse.statusCode, seleniumResponse.headers);
        seleniumResponse.on('data', function(data) {
          response.write(data);
        });
        seleniumResponse.on('end', function() {
          response.end(); 
        });
      }, function(seleniumError) {
      response.writeHead(500);
      response.write(seleniumError.code + ': ' + seleniumError.toString());
      response.end();
      });
    });
  });
};

StabilityProxy.prototype.listen = function(port) {
  this.server.listen(port);
};

exports.StabilityProxy = StabilityProxy;
