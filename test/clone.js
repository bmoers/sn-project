const Git = require('../lib/git');


const git = new Git({ dir: '/private/tmp/bla' })

git.clone('git@github.com:bmoers/x_11413_cicd_test', '/private/tmp/bla/repo');
