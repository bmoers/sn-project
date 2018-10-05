var chai = require("chai"),
    expect = chai.expect,
    assert = chai.assert;

var puppeteer = require('puppeteer');

var SnRestClient = require("sn-rest-client"),
    Promise = require('bluebird'),
    fs = Promise.promisifyAll(require("fs"));

var addContext = require('mochawesome/addContext');

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
    }, (type === TEST) ? {
        testId: id
    } : {
        suiteId: id
    }).then(function (result) {

        var test = result[0],
            executionId = test.executionId,
            name = test.name,
            url = test.url;

        describe(`Execute ATF: Run ${(type === TEST? 'Test': 'Test Suite')} "${name}"`, function () {

            it('Job started', function (done) {
                addContext(this, url);
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
        maxIter = (MAX_WAIT_SEC * 1000 / WAIT_DELAY_MS),
        iter = 0,
        delay = 500;

    return promiseFor(function (state) {
        return (state < 2);
    }, function () {

        return client.get({
            url: "/api/swre/v1/va/atf/track/".concat(testExecutionID),
            qs: {
                sysparm_display_value: 'all'
            }
        }).then(function (result) {
            iter++;

            executionTracker = result[0];
            var state = parseInt(executionTracker.state.value || 2, 10);
            console.log('\tSTATE is: ', executionTracker.state.display_value, '#', iter);

            if (iter >= maxIter) {
                throw {
                    statusCode: -999,
                    error: {
                        error: {
                            message: "Test did not complete in SNOW after " + MAX_WAIT_SEC + " seconds."
                        }
                    }
                };
            } else if (state <= 1) {
                return Promise.delay(delay).then(function () {
                    return state;
                });
            } else {
                return state;
            }

        }).then(function (state) {
            return state;
        });

    }, 0).then(function () {

        describe(`Execute ATF: Wait for Test Execution to complete`, function () { // - Execution ID: "${testExecutionID}"

            it(`Test execution completed: "${executionTracker.state.display_value}" after ${(iter * delay / 1000)} seconds`, function (done) {
                addContext(this, executionTracker.url);
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

        describe('RUN: Process Snow Test Results', function () {
            it('Get all test results from ServiceNow', function (done) {
                expect(result.length).to.equal(1, 'no test results found');
                done();
            });
        });

        return testExecutionResult;
    });
};

var logSnowTestResults = function (testExecutionResult) {
    console.log("logSnowTestResults");
    //console.dir(testExecutionResult, { depth: null, colors: true });

    if (testExecutionResult.type == 'test_suite_result') {

        describe(`Test-Suite Result: "${testExecutionResult.number}"`, function () {

            it('Test-Suite Overall Result', function (done) {
                addContext(this, testExecutionResult.url);
                expect(testExecutionResult.status).to.equal('success');
                done();
            });

            (testExecutionResult.testResults || []).forEach(function (testResult) {

                describe(`Test Result: "${testResult.number}"`, function () {
                    testResult.stepResults.forEach(function (stepResult) {
                        it(`${stepResult.order} : ${stepResult.startTime} - ${stepResult.step}`, function (done) {
                            addContext(this, stepResult.url);
                            expect(stepResult.status).to.equal('success');
                            done();
                        });
                    });
                });
            });

        });
    } else {

        describe(`Test Result: "${testExecutionResult.number}"`, function () {
            testExecutionResult.stepResults.forEach(function (stepResult) {
                it(`${stepResult.order} : ${stepResult.startTime} - ${stepResult.step}`, function (done) {
                    addContext(this, stepResult.url);
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


var openTestRunner = function (config, url) {
    var credentials = config.atf.credentials.oauth;
    var executablePath = config.atf.browser.bin;
    return Promise.try(() => {
        return puppeteer.launch({
            ignoreHTTPSErrors: true,
            headless: true,
            executablePath: executablePath
        });
    }).then((browser) => {
        return browser.newPage().then((page) => {
            return page.setExtraHTTPHeaders({
                'Authorization': authorization
            }).then(() => {
                // get a session cookie without being redirected to SAML endpoint
                return page.goto(`${host}/api/now/table/sys_user/0`, {
                    waitUntil: 'networkidle2'
                });
            }).then(() => {
                page.close();
            });
        }).then(() => {
            return browser.newPage().then((page) => {
                return page.setViewport({
                    width: 1400,
                    height: 800
                }).then(() => {
                    return page.setUserAgent('Mozilla/5.0 (Windows; U; Windows NT 6.1; rv:2.2) Gecko/20110201');
                }).then(() => {
                    return page.goto(url, {
                        waitUntil: 'networkidle2'
                    });
                });
            });
        }).then(() => {
            return browser;
        });
    }).delay(1000).then((browser) => {
        console.log("browser started and ready");
        return browser;
    });
};

var closeTestRunner = function (runner) {
    return Promise.try(() => {
        if (runner)
            return runner.close();
    });
};

describe("Execute ATF: Wrapper", function () {

    return getTestConfiguration().then(configureClient).then(function (config) {

        var testConfig = config.atf;

        return Promise.try(function () {

            if ((testConfig.suites || []).length + (testConfig.tests || []).length === 0) {
                console.warn("NO TEST FOUND");
                return false;
            }
            
            return Promise.each(testConfig.suites || [], function (suiteId) {
                //console.log("RUN SUITE: ", suiteId);
                return openTestRunner(config, config.host.name + '/nav_to.do?uri=atf_test_runner.do%3fsysparm_scheduled_tests_only%3dfalse%26sysparm_nostack%3dtrue').then((runner) => {
                    return remoteTest(suiteId, TEST_SUITE).finally(() => {
                        return closeTestRunner(runner);
                    });
                });
                
            }).then(function () {
                return Promise.each(testConfig.tests || [], function (testId) {
                    //console.log("RUN TEST: ", testId);
                    return openTestRunner(config, config.host.name + '/nav_to.do?uri=atf_test_runner.do%3fsysparm_scheduled_tests_only%3dfalse%26sysparm_nostack%3dtrue').then((runner) => {
                        return remoteTest(testId, TEST).finally(() => {
                            return closeTestRunner(runner);
                        });
                    });

                });

            }).catch(function (e) {

                var message = e.error ? e.error.error ? e.error.error.message : e.error.message : e.message || 'no message';

                describe('Execute ATF: RuntimeError ', function () {
                    it('Failed with', function (done) {
                        console.error(message);
                        expect.fail(0, 1, message); // force fail
                        done();
                    });
                });

            }).finally(function () {                

            }).then(function () {
                console.log("execute Mocha Tests...");
                run();
            });
        });

    });

});