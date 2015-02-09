/**
 * Starts up a proxy server which modifies calls between the test process
 * and the selenium server.
 */

var http = require('http');
var url = require('url');

var seleniumAddress = 'http://localhost:4444/wd/hub';

var parsedUrl = url.parse(seleniumAddress);

var sendRequest = function(method, url, data, callback) {
  var options = {};
  options.method = method;
  options.path = parsedUrl.path + url;
  options.hostname = parsedUrl.hostname;
  options.port = parsedUrl.port;

  console.dir(options);
  var request = http.request(options, callback);

  request.on('error', function(error) {
    console.dir(error);
    // TODO - do something intelligent with the error.
  });

  if (data) {
    request.write(data);
  }
  request.end();
};

var server = http.createServer();
server.on('request', function(message, response) {
  console.dir(message.headers);
  console.dir(message.method);
  console.dir(message.url);
  var requestData;

  message.on('data', function(data) {
    console.log('-- data! --');
    console.dir(data.toString());
    requestData = data;
  });

  message.on('end', function() {
    console.log('-- end of message');
    sendRequest(message.method, message.url, requestData, function(seleniumResponse) {
      response.writeHead(seleniumResponse.statusCode, seleniumResponse.headers);
      console.log('-- seleniumResponse');
      seleniumResponse.on('data', function(data) {
        response.write(data);
      });
      seleniumResponse.on('end', function() {
        response.end(); 
      });
    });
  });
});

server.listen(8111);

