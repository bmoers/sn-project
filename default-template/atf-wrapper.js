var chai = require("chai"),
    expect = chai.expect,
    assert = chai.assert;

var SnRestClient = require("sn-rest-client"),
    Promise = require('bluebird'),
    fs = Promise.promisifyAll(require("fs"));

var promiseFor = Promise.method(function (condition, action, value) {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});

var client,
    TEST_SUITE = 1,
    TEST = 2,
    MAX_WAIT_SEC = 600, // time in seconds for the test to complete
    WAIT_DELAY_MS = 500, // delay in mseconds for the test status to check.
    BROWSER = "C:\\PROGRA~1\\INTERN~1\\iexplore.exe";

var getTestConfiguration = function () {
    return fs.readFileAsync('config\\project.json', {
        encoding: 'utf8'
    }).then(function (config) {
        return JSON.parse(config);
    });
};

var configureClient = function (config) {

    var credentials = config.atf.credentials.oauth;

    client = new SnRestClient({
        host_name: config.host.name,
        proxy: config.settings.proxy,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        auth_code: credentials.authCode,
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken,
        debug: false,
        silent: true
    });

    return config;
};

var executeTestInSnow = function (id, type) {
    console.log("executeTestInSnow", id, type);
    return client.post({
        url: (type === TEST) ? "/api/swre/v1/va/atf/test" : "/api/swre/v1/va/atf/suite"
    }, (type === TEST) ? { testId: id } : { suiteId: id }).then(function (result) {

        var executionId = result[0].executionId;

        describe('Execute Test in Snow: \''.concat(id).concat('\' - Execution ID: \'').concat(executionId).concat('\''), function () {
            it('Job started', function (done) {
                expect(result.length).to.equal(1, 'unexpected REST result');

                expect(executionId, 'no test execution ID found').to.not.be.null;
                done();
            });
        });
        return executionId;
    });
};

var waitForTestInSnowToComplete = function (testExecutionID) {

    console.log("waitForTestInSnowToComplete", testExecutionID);
    var executionTracker,
        maxIter = (MAX_WAIT_SEC * 1000 / WAIT_DELAY_MS)
    iter = 0;

    return promiseFor(function (state) { return (state < 2); }, function () {

        return client.get({
            url: "api/now/table/sys_execution_tracker/".concat(testExecutionID),
            qs: {
                sysparm_display_value: 'all'
            }
        }).then(function (result) {
            iter++;

            executionTracker = result[0];
            var state = parseInt(executionTracker.state.value || 2, 10);
            console.log('\tSTATE is: ', executionTracker.state.display_value, '#', iter);

            if (iter >= maxIter) {
                throw { statusCode: -999, error: { error: { message: "Test did not complete in SNOW after " + MAX_WAIT_SEC + " seconds." } } };
            } else if (state <= 1) {
                return Promise.delay(500).then(function () {
                    return state;
                });
            } else {
                return state;
            }

        }).then(function (state) {
            return state;
        });

    }, 0).then(function () {

        describe('Wait for Test Execution to complete in SNOW'.concat('\' - Execution ID: \'').concat(testExecutionID).concat('\''), function () {

            it('Test execution completed: '.concat(executionTracker.state.display_value), function (done) {
                expect(executionTracker, 'no test status information found').to.not.be.null;
                done();
            });

        });

        // only the result field is of interest
        return JSON.parse(executionTracker.result.value);
    });
};

var getTestResultsFromSnow = function (testResultObject) {
    console.log("getTestResultsFromSnow");

    return client.get({
        url: (function () {
            if (testResultObject.result_id) {
                return "/api/swre/v1/va/atf/test/".concat(testResultObject.result_id);
            } else {
                return "/api/swre/v1/va/atf/suite/".concat(testResultObject.test_suite_result_id);
            }
        })()
    }).then(function (result) {
        var testExecutionResult = result[0];

        describe('Process Snow Test Results', function () {
            it('Get all test results', function (done) {

                expect(result.length).to.equal(1, 'no test results found');

                done();
            });
        });

        return testExecutionResult;
    });
};

var logSnowTestResults = function (testExecutionResult) {
    console.log("logSnowTestResults");

    if (testExecutionResult.type == 'test_suite_result') {

        describe('SNOW Test-Suite Result: '.concat(testExecutionResult.number), function () {

            it('Test-Suite overall result', function (done) {
                expect(testExecutionResult.status).to.equal('success');
                done();
            });

            (testExecutionResult.testResults || []).forEach(function (testResult) {

                describe('Test-Suite-Test Result: '.concat(testResult.number), function () {

                    testResult.stepResults.forEach(function (stepResult) {
                        it(stepResult.step.concat('-').concat(stepResult.order).concat('-').concat(stepResult.startTime), function (done) {
                            //console.log('Output: "', stepResult.summary, '"');
                            expect(stepResult.status).to.equal('success');

                            done();
                        });
                    });

                });
            });


        });
    } else {

        describe('SNOW Test Result: '.concat(testExecutionResult.number), function () {

            testExecutionResult.stepResults.forEach(function (stepResult) {
                it(stepResult.step.concat('-').concat(stepResult.order).concat('-').concat(stepResult.startTime), function (done) {
                    //console.log('Output: "', stepResult.summary, '"');
                    expect(stepResult.status).to.equal('success');

                    done();
                });
            });

        });
    }
};

var remoteTest = function (id, type) {
    return executeTestInSnow(id, type)
        .then(waitForTestInSnowToComplete)
        .then(getTestResultsFromSnow)
        .then(logSnowTestResults);
};

describe("ATF-Wrapper", function () {

    return getTestConfiguration().then(configureClient).then(function (config) {


        var testConfig = config.atf;
        var browser = testConfig.browser.bin || BROWSER;
        var arg = testConfig.browser.arg || ['-nomerge'];

        return Promise.try(function () {

            if ((testConfig.suites || []).length + (testConfig.tests || []).length === 0) {
                console.warn("NO TEST FOUND");
                return false;
            }

            var cp;
            return Promise.try(function () {
                console.log("Open Browser", new Date());
                cp = require('child_process').spawn(browser, arg.concat([config.host.name + '/nav_to.do?uri=atf_test_runner.do%3fsysparm_scheduled_tests_only%3dfalse%26sysparm_nostack%3dtrue']), { detached: true });
                console.log('PID is:', cp.pid);
            }).delay(30000).then(function () {
                return Promise.each(testConfig.suites || [], function (suiteId) {
                    //console.log("RUN SUITE: ", suiteId);
                    return remoteTest(suiteId, TEST_SUITE);
                });
            }).then(function () {
                return Promise.each(testConfig.tests || [], function (testId) {
                    //console.log("RUN TEST: ", testId);
                    return remoteTest(testId, TEST);
                });
            }).then(function () {

            }).catch(function (e) {
                describe('SNOW Execution  ', function () {
                    it('Failed with', function (done) {
                        console.log(e);
                        console.log(Object.keys(e));
                        var message = e.error ? e.error.error ? e.error.error.message : null : null || 'no message';
                        expect(e.statusCode, message).to.equal(200);
                        done();
                    });
                });
            }).finally(function () {
                after(function () {
                    try {
                        // runs after all tests in this block
                        console.log('Closing the browser. PID:', cp.pid);
                        //cp.kill('SIGINT');
                        process.kill(cp.pid);
                    } catch (e) {
                        console.log("was not able to kill browser with PID", e);
                    }
                });

            }).then(function () {
                console.log("execute Mocha Tests...");
                run();
            });
        });

    });

});