var Snproject = require('../index');
var project = new Snproject({
    dir: 'C:/cicd-server/repos/11',
    appName: 'TestApp',
    dbName: 'TestDb',
    organization: 'TestOrg'
});

project.install().then((m) => {
    console.log('installed', m)
}).catch((e) => {
    console.log(e);
});