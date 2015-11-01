/**
 * Starts up a proxy server which modifies calls between the test process
 * and the selenium server.
 */

var StabilityProxy = require('lib/stabilityproxy').StabilityProxy;

var proxy = new StabilityProxy();
proxy.listen(8111);
