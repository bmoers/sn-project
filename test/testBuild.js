var Snproject = require('../index');
var project = new Snproject({
    dir: 'C:/cicd-server/repos/va',
    appName: 'TestApp',
    dbName: 'TestDb',
    organization: 'TestOrg'
});

project.build().then((result) => {
    console.log(result.log);
}).catch((error) => {
    console.log(error.log);
    /*
    console.log("---------------------------------------------------");
    console.log(e);
    console.log("---------------------------------------------------");
    */
});