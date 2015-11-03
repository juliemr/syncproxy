/**
 * Wait until Angular has finished rendering and has
 * no outstanding $http calls before continuing. The specific Angular app
 * is determined by the rootSelector.
 * This is executed in the context of the browser.
 *
 * Asynchronous.
 *
 * @param {string} rootSelector The selector housing an ng-app
 * @param {function(string)} callback callback. If a failure occurs, it will
 *     be passed as a parameter.
 */
  // TODO make rootSelector a parameter and figure out how to customize it. Don't worry
  // about backwards compatibility.
exports.NG_WAIT_FN = function(callback) {
  var rootSelector = 'body';
  var el = document.querySelector(rootSelector);

  try {
    if (window.getAngularTestability) {
      window.getAngularTestability(el).whenStable(callback);
      return;
    }
    if (!window.angular) {
      throw new Error('angular could not be found on the window');
    }
    if (angular.getTestability) {
      angular.getTestability(el).whenStable(callback);
    } else {
      if (!angular.element(el).injector()) {
        throw new Error('root element (' + rootSelector + ') has no injector.' +
           ' this may mean it is not inside ng-app.');
      }
      angular.element(el).injector().get('$browser').
          notifyWhenNoOutstandingRequests(callback);
    }
  } catch (err) {
    callback(err.message);
  }
};


/**
 * Wait until all Angular2 applications on the page have become stable.
 *
 * Asynchronous.
 *
 * @param {function(string)} callback callback. If a failure occurs, it will
 *     be passed as a parameter.
 */
exports.NG2_WAIT_FN = function(callback) {
  try {
    var testabilities = window.getAllAngularTestabilities();
    var count = testabilities.length;
    var decrement = function() {
      count--;
      if (count === 0) {
        callback();
      }
    };
    testabilities.forEach(function(testability) {
      testability.whenStable(decrement);
    });
  } catch (err) {
    callback(err.message);
  }
};
