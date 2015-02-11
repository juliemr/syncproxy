/**
 * Starts up a proxy server which modifies calls between the test process
 * and the selenium server.
 */

var http = require('http');
var url = require('url');
var q = require('q');


/**
 * @constructor
 */
var StabilityProxy = function() {

};

var seleniumAddress = 'http://localhost:44443/wd/hub';

var parsedUrl = url.parse(seleniumAddress);

var stabilityEnabled = false;

// TODO - should be refactored to be a pretty object
// TODO - should implement its own API to modify state.

/** This will be called in the context of the browser */
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

var waitForAngularData = JSON.stringify({
  script: 'return (' + WAIT_FOR_ANGULAR_FUNCTION + ').apply(null, arguments);',
  args: []
});

var sendRequest = function(method, url, data, callback, errback) {
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

// Halt (no, too harsh), hold, await, wait, synchronize (no, too overloaded)
var shouldStabilize = function(commandPath) {
  if (!stabilityEnabled) {
    return false;
  }

  if (isProxyCommand(commandPath)) {
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

var isProxyCommand = function(commandPath) {
  return (commandPath.split('/')[1] === 'stabilize_proxy');
}

/**
 * Stability should be enabled once we've gotten a URL. We don't want to
 * call waitForAngular in the middle of getting URLs.
 *
 * TODO - figure out how this interacts with getting pages in Protractor.
 *
 * We could enable this from Protractor, so Protractor would be responsible
 * for turning it off while it's getting a URL.
 */
var shouldEnableStability = function(commandPath) {
  return true;
}

var executeAsyncUrl = function(originalUrl) {
  var parts = originalUrl.split('/');
  return [parts[0], parts[1], parts[2], 'execute_async'].join('/');
};



var server = http.createServer();
server.on('request', function(message, response) {
  var stabilized = q(null);

  if (shouldStabilize(message.url)) {
    var deferred = q.defer();
    stabilized = deferred.promise;
    sendRequest('POST', executeAsyncUrl(message.url), waitForAngularData, function(stabilizeResponse) {
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

  if (shouldEnableStability(message.url)) {
    stabilityEnabled = true;
  }
  
  var requestData;

  message.on('data', function(data) {
    // TODO this will only work if there is only one piece of data
    requestData = data;
  });

  message.on('end', function() {
    if (isProxyCommand(message.url)) {
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
            response.write(JSON.stringify({value: seleniumAddress}));
            response.end();
          } else if (message.method === 'POST') {
            response.writeHead(200);
            seleniumAddress = JSON.parse(requestData).value;
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
});

server.listen(8111);

