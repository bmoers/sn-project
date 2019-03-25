/*

    TODO:
    e.g. replace with https://www.npmjs.com/package/simple-git
    if local git is an issue: https://www.npmjs.com/package/nodegit 

*/

var Promise = require('bluebird');
var git = Promise.promisifyAll(require('gulp-git'));
var fs = Promise.promisifyAll(require("fs"));
var mkdirp = Promise.promisifyAll(require('mkdirp'));
var path = require("path");
var escape = require('any-shell-escape'),
    ObjectAssignDeep = require('object-assign-deep');
var tmp = Promise.promisifyAll(require('tmp'));

var defaultConfig = {
    user: {
        name: null,
        email: null
    },
    dir: null,
    dirName: null,
    remoteUrl: null,
    currentPath: null,
    quiet: true,
    gitignore: ['# Logs and databases #',
        '###################',
        'logs', '*.log',
        '# Compiled source #',
        '###################',
        '*.com', '*.class', '*.dll', '*.exe', '*.o', '*.so',
        '*.sql', '*.sqlite',
        '# Packages #', '############',
        '*.7z', '*.dmg', '*.gz', '*.iso', '*.jar', '*.rar', '*.tar', '*.zip',
        '# various files #',
        '######################',
        'pids', '*.pid', '*.seed', '*.pid.lock', 'coverage', '.nyc_output',
        '.grunt', 'bower_components', '.lock-wscript', 'build/Release', 'node_modules/', 'jspm_packages/', 'typings/', '.npm', '.eslintcache', '.node_repl_history', '.yarn-integrity', '.env',
        '# OS generated files #',
        '######################',
        '.DS_Store',
        '.DS_Store?',
        '._*',
        '.Spotlight-V100',
        '.Trashes',
        'ehthumbs.db',
        'Thumbs.db',
        '###################',
        '# IDE files #',
        '.classpath', '.project', '.settings', '.idea', '.metadata', '*.iml', '*.ipr',
        '###################',
        '# Documentation files #',
        '',
        '###################',
        '# Custom files #'
    ]
};



function Git(config) {
    var self = this;

    self.configuration = ObjectAssignDeep.withOptions({}, [defaultConfig, config], { arrayBehaviour: 'merge' });
    if (!self.configuration.dir)
        throw 'dir is required';

    self.configuration.dir = path.resolve(self.configuration.dir);
    //console.log(self.configuration);
    self.log = (!self.configuration.quiet);
    //console.log('GIT ready');
}

Git.prototype.config = function (property, value) {
    var self = this;
    return new Promise((resolve, reject) => {
        if (property) {
            var arg = `config ${property}`;
            if (value)
                arg = arg.concat(` "${value}"`);
            return resolve(arg);
        }
        return reject(new Error('property not defined. Use e.g. config(\'user.email\', \'user@domain.com\')'));
    }).then((arg) => {
        return self.exec({
            quiet: self.configuration.quiet,
            args: arg
        });
    });
};

Git.prototype.getDirectory = function () {
    var self = this;
    return self.configuration.dir;
}

Git.prototype.switchToBranch = function () {
    var self = this;
    var arg = arguments;
    return _switchToBranch.apply(self, arg);
};

Git.prototype.createBranch = function () {
    var self = this;
    var arg = arguments;
    return _createBranch.apply(self, arg);
};

Git.prototype.toBranchName = function () {
    var self = this;
    var arg = arguments;
    return Promise.try(function () {
        return _sanitizeBranchName.apply(self, arg);
    });
};

Git.prototype.deleteBranch = function () {
    var self = this;
    var arg = arguments;
    return _deleteBranch.apply(self, arg);
};

Git.prototype.deleteBranchRemote = function () {
    var self = this;
    var arg = arguments;
    return _deleteBranchRemote.apply(self, arg);
};

Git.prototype.reset = function () {
    var self = this;
    var arg = arguments;
    return _reset.apply(self, arg);
};


Git.prototype.merge = function () {
    var self = this;
    var arg = arguments;
    return _merge.apply(self, arg);
};
Git.prototype.mergeAbort = function () {
    var self = this;
    return _mergeAbort.apply(self);
};


Git.prototype.add = function (files) {
    var self = this;
    return _add.call(self, files);
};
Git.prototype.addAll = function () {
    var self = this;
    return _addAll.call(self);
};
Git.prototype.delete = function (files) {
    var self = this;
    return _delete.call(self, files);
};

Git.prototype.addDeleted = function () {
    var self = this;
    return _addDeleted.call(self);
};

Git.prototype.rm = function (files) {
    var self = this;
    return _delete.call(self, files);
};

Git.prototype.commit = function (options) {
    var self = this;
    return _commit.call(self, options);
};

Git.prototype.fetch = function (branchName) {
    var self = this;
    return _fetch.call(self, branchName);
};

Git.prototype.pull = function (branchName) {
    var self = this;
    return _pull.call(self, branchName);
};

Git.prototype.push = function (branchName, force) {
    var self = this;
    return _push.call(self, branchName, force);
};

Git.prototype.exec = function () {
    var self = this;
    return _execAsync.apply(self, arguments);
};

Git.prototype.getCommitIds = function (latest = 25) {
    var self = this;
    return _execAsync.call(self, {
        quiet: self.configuration.quiet,
        args: `log --format="%H" -n ${latest}`
    }).then((history) => {
        return history.split(/[\r\n]+/).filter((row) => {
            return (row && row.length);
        });
    });
};

Git.prototype.getLastCommitId = function () {
    var self = this;
    return self.getCommitIds(1).then((ids) => {
        return ids[0];
    });
};


Git.prototype.init = function () {
    var self = this;
    return _init.apply(self, arguments);
};

Git.prototype.initialized = function () {
    var self = this;
    return _gitInitialized.call(self);
};

Git.prototype.branchConfig = function (branchName) {
    var self = this;
    return _branchConfig.call(self, branchName);
};

/*
Git.prototype._renameBranch = function (branchName) {
    var self = this;
    return _renameBranch.call(self, branchName);
};
*/

var _createGitIgnoreFile = function (force) {
    var self = this;
    var gitIgnoreFile = path.join.apply(null, [self.configuration.dir, '.gitignore']);

    const writeGitIgnore = () => {
        return fs.writeFileAsync(
            gitIgnoreFile,
            self.configuration.gitignore.join('\n'),
            { encoding: 'utf8' }
        ).then(function () {
            return true;
        });
    }

    return fs.statAsync(gitIgnoreFile).then(function () {
        if (!force) {
            console.log("createGitIgnoreFile, file exists already", gitIgnoreFile);
            return false;
        }
        console.log("createGitIgnoreFile, update file", gitIgnoreFile);
        return writeGitIgnore();
    }).catch({
        code: 'ENOENT'
    }, function () {
        console.log("createGitIgnoreFile, create new file", gitIgnoreFile);
        return writeGitIgnore();
    });
};

var _execAsync = function (options) {
    var self = this;
    options.cwd = self.configuration.dir;
    return git.execAsync(options);
};

/*
    can this be done better ?
    https://stackoverflow.com/questions/2180270/check-if-current-directory-is-a-git-repository
*/
var _gitInitialized = function () {
    var self = this;
    return _execAsync.call(self, {
        args: 'status',
        quiet: self.configuration.quiet
    }).then(function () {
        return true;
    }).catch(function () {
        return false;
    }).then(function (initialized) {
        return initialized;
    });
};

var _addToKnownHosts = function (remoteUrl) {
    var self = this,
        regex = /ssh:\/\/(?:([^@]*)@)?([^\/:]*)(?::(\d+))?\//;

    return Promise.try(function () {
        if (remoteUrl.toLowerCase().trim().indexOf('ssh://') !== 0)
            return;

        var match = regex.exec(remoteUrl);
        if (match && match.length) {

            var user = match[1] || null;
            var host = match[2] || null;
            var port = match[3] || null;
            var commandExists = require('command-exists');

            //console.log(user, host, port);

            var cmd = (port) ? `ssh-keyscan -p ${port} ${host} >> ~/.ssh/known_hosts` : `ssh-keyscan ${host} >> ~/.ssh/known_hosts`;

            var exec = require('child_process').exec;

            return commandExists('ssh-keyscan').then(function () {
                console.log("adding key file to known_hosts");
                return new Promise(function (resolve, reject) {
                    //console.log(cmd);
                    exec(cmd, { maxBuffer: 200 * 1024 }, function (err, stdout, stderr) {
                        if (err) return reject(err);
                        console.log(stdout, stderr);
                        resolve();
                    });
                });
            }).catch(function () {
                /*
                    use putty to add key to registry 
                    under HKEY_CURRENT_USER\SoftWare\SimonTatham\PuTTY\SshHostKeys and not taken from the known_hosts file
                */
                return commandExists('plink').then(function () {
                    var cmd = ['echo y | plink -ssh '];
                    if (port)
                        cmd.push(`-P ${port} `);
                    if (user)
                        cmd.push(`${user}@`);

                    cmd.push(host);
                    cmd.push(' echo test');
                    cmd = cmd.join('');

                    console.log("adding key via plink");
                    return new Promise(function (resolve, reject) {
                        //console.log(cmd);
                        exec(cmd, { maxBuffer: 200 * 1024 }, function (err, stdout, stderr) {
                            if (err) return reject(err);
                            console.log(stdout, stderr);
                            resolve();
                        });
                    }).catch(function (e) {
                        //console.log(e);
                    });
                }).catch(function () {
                    // command doesn't exist 
                    console.log("MAKE SURE THE REMOTE HOST IS IN THE known_host FILE");
                });
            });
        }
    });
};

var _init = function (appendCommitMessage) {
    var self = this;
    //var notEmptyLocalDir = true;
    return fs.statAsync(self.configuration.dir).catch({
        code: 'ENOENT'
    }, function () {
        //notEmptyLocalDir = false;
        return mkdirp.mkdirpAsync(self.configuration.dir);
    }).then(function () {
        return _gitInitialized.call(self);
    }).then(function (initialized) {
        if (!initialized) {
            // initialize the repo, in case of a remote, clone the repo
            return Promise.try(function () {
                if (self.configuration.remoteUrl) { // && notEmptyLocalDir === false
                    console.log("clone from remote", self.configuration.remoteUrl, self.configuration.dir);
                    return _addToKnownHosts.call(self, self.configuration.remoteUrl).then(function () {

                        //console.log(['git', 'clone', self.configuration.remoteUrl, self.configuration.dir].join(' '));

                        /*
                            add https support
                            git clone https://username:password@myrepository.biz/file.git
                        */

                        return _execAsync.call(self, {
                            quiet: self.configuration.quiet,
                            args: ['clone', self.configuration.remoteUrl, self.configuration.dir].join(' ')
                        });
                    });
                } else {
                    console.log("git init");
                    return _execAsync.call(self, {
                        quiet: self.configuration.quiet,
                        args: 'init'
                    });
                }
            }).then(function () {
                if (self.configuration.user.name)
                    return self.config('user.name', self.configuration.user.name);
            }).then(function () {
                if (self.configuration.user.email)
                    return self.config('user.email', self.configuration.user.email);

            }).then(function () {
                return _switchToBranch.call(self, 'master').catch((ignore) => {
                    // in case of empty repo this wont work
                });

            }).then(function () {
                return _createGitIgnoreFile.call(self, true);

            }).then(function (gitIgnoreTouched) {
                if (!gitIgnoreTouched)
                    return;

                console.log("git add .gitignore");
                return _add.call(self, '.gitignore').then(function () {
                    const commit = {
                        messages: [`update.gitignore`]
                    };
                    if (appendCommitMessage) {
                        commit.messages.push(appendCommitMessage)
                    }
                    console.log(`git commit -m "${commit.messages.join('\\n')}"`);
                    return _commit.call(self, commit).catch(function (ignore) {
                        //console.dir(ignore, { depth: null, colors: true });
                    });
                    /*
                    return _execAsync.call(self, {
                        args: `commit -m "update .gitignore"`,
                        quiet: self.configuration.quiet
                    }).catch(function (ignore) {
                        //console.dir(ignore, { depth: null, colors: true });
                    });
                    */
                });

            }).then(function () {
                /*
                if (self.configuration.remoteUrl && notEmptyLocalDir === true) {

                    // as the local directory is not empty anymore....
                
                    console.log(`remote add origin ${self.configuration.remoteUrl}`)
                    return _execAsync.call(self, {
                        quiet: self.configuration.quiet,
                        args: `remote add origin ${self.configuration.remoteUrl}`
                    }).then(function () {
                        // in case there is already code in the remote, this will fail
                        return _execAsync.call(self, {
                            quiet: self.configuration.quiet,
                            args: `push -u origin master`
                        }).catch(function () {
                            // in that case add all remote branch manually
                           return _addRemote.call(self);
                        });
                    });
                }
                */
            }).then(function () {
                // push changes to remote
                if (self.configuration.remoteUrl) {
                    return Promise.try(function () {
                        return _push.call(self);
                    }).then(function () {
                        console.log("all files pushed to remote");
                    }).catch(function (err) {
                        console.error("push to remote failed. make sure the ssh key has no passphrase (ssh-keygen -p)");
                        return err;
                    }).then(function () {
                        return _pull.call(self);
                    });
                }
            });

        } else {
            return _addRemote.call(self);
        }
    });
};

var _addRemote = function () {
    var self = this;
    if (self.configuration.remoteUrl) {
        return _execAsync.call(self, {
            args: 'remote',
            quiet: self.configuration.quiet
        }).then(function (currentName) {
            currentName = currentName.replace(/(\r\n|\n|\r)/gm, "");
            if ("origin" == currentName) {
                if (!self.configuration.quiet)
                    console.log("\tremote origin already added");
            } else {
                console.log("set origin to ", self.configuration.remoteUrl);
                return _execAsync.call(self, {
                    quiet: self.configuration.quiet,
                    args: 'remote add origin '.concat(self.configuration.remoteUrl)
                }).then(function () {
                    return _execAsync.call(self, {
                        quiet: self.configuration.quiet,
                        args: 'fetch --all'
                    }).then(function () {
                        // get the local branch names
                        return _execAsync.call(self, {
                            quiet: self.configuration.quiet,
                            args: 'branch -l'
                        }).then((localBranchNames) => {
                            return localBranchNames.split(/[\n\r]+/).filter((row) => {
                                return (row && row.length);
                            }).map((row) => {
                                return row.replace(/^\*?\s*/gm, '').trim();
                            });
                        });
                    }).then((localBranchNames) => {
                        return _execAsync.call(self, {
                            quiet: self.configuration.quiet,
                            args: 'branch -r'
                        }).then((remoteBranchNames) => {
                            return remoteBranchNames.split(/[\n\r]+/).filter((row) => {
                                return (row && row.length && (localBranchNames.indexOf(row.replace('origin/', '').trim()) === -1));
                            }).map((row) => {
                                return row.trim();
                            });
                        });
                    }).then(function (checkoutBranchNames) {
                        return Promise.each(checkoutBranchNames, function (checkoutBranchName) {

                            return _execAsync.call(self, {
                                quiet: self.configuration.quiet,
                                args: 'checkout --track '.concat(checkoutBranchName)
                            }).catch((e) => {
                                console.warn('checkout failed', e);
                            });

                            /*
                            var localBranch = remoteBranch.replace('origin/', '');
                            console.log('branch --set-upstream-to='.concat(remoteBranch).concat(' ').concat(localBranch));
                            return _execAsync.call(self, {
                                quiet: self.configuration.quiet,
                                args: 'branch --set-upstream-to='.concat(remoteBranch).concat(' ').concat(localBranch)
                            });
                            */

                        });
                    });
                }).then(function () {
                    return _pull.call(self);
                });
            }
        });
    }
};

var _sanitizeBranchName = function () {
    var self = this;
    var args = (arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments)),
        name = [];
    var strictPattern = /^[\./]|\/|\.\.|@{|[\/\.]$|^@$|[~^:\x00-\x20\x7F\s?*[\\]/g;
    args.forEach(function (argument) {
        if (argument !== undefined)
            name.push(argument.replace(/[^@\w-_#]+/g, '-').replace(/-+/g, '-').replace(/^-?(.*[^-]+)-?$/g, '$1').toLowerCase());
    });
    return name.join('/');
};

var _switchToBranch = function () {
    var self = this;
    var branchName = _sanitizeBranchName.apply(self, arguments);
    console.log("Switch to branch: ", branchName);

    return _execAsync.call(self, {
        args: 'rev-parse --abbrev-ref HEAD',
        quiet: self.configuration.quiet
    }).then(function (currentName) {
        //console.log("currentName", currentName);
        currentName = currentName.replace(/(\r\n|\n|\r)/gm, "");
        if (branchName == currentName) {
            console.log("\talready there");
            return Promise.resolve();
        } else {
            console.log("\tcheckout", branchName);
            return _branchExists.call(self, branchName).then(function (exists) {
                return Promise.try(function () {
                    if (!exists)
                        return _createBranch.call(self, branchName);
                }).then(function () {
                    return git.checkoutAsync(branchName, {
                        args: null, //(exists) ? null : '-b',
                        quiet: self.configuration.quiet,
                        cwd: self.configuration.dir
                    });
                });
            });
        }
    });
};

var _branchExists = function (checkBranchName) {
    var self = this;
    return _branchConfig.call(self, checkBranchName).then((branchConfig) => {
        return (branchConfig && branchConfig.exist);
    })
};

var _branchConfig = function (checkBranchName) {
    //console.log("branch exists?", checkBranchName)
    if (!checkBranchName)
        return Promise.resolve(false);

    var self = this;
    var checkName = checkBranchName.toLowerCase();
    return _execAsync.call(self, {
        quiet: self.configuration.quiet,
        args: 'branch -a'
    }).then(function (branchNames) {
        return branchNames.split(/[\r\n]+/).reduce(function (prev, name) {
            name = name.trim().replace(/^\*\s+/g, '');
            if (name) {
                name = name.split(' -> ')[0];
                prev.push(name);
            }
            return prev;
        }, []);
    }).then(function (branches) {

        const branch = {
            exist: false,
            hasRemote: false,
            name: null,
            rename: false,
            oldName: null
        };
        let checkBranchId = null;
        const idMatch = (/^\S+-@([a-f0-9]{32})$/).exec(checkName);
        if (idMatch)
            checkBranchId = idMatch[1];

        branches.forEach((branchName) => {

            if (branchName.indexOf(`remotes/origin/${checkName}`) === 0) {
                branch.exist = true;
                branch.hasRemote = true;
            } else if (branchName.indexOf(`${checkName}`) === 0) {
                branch.exist = true;
                branch.hasRemote = branch.hasRemote || false;
            } else if (branchName.indexOf(`-@${checkBranchId}`) !== -1) {
                // branch was renamed
                branch.exist = true;
                branch.hasRemote = branch.hasRemote || Boolean(branchName.indexOf('remotes/origin/') === 0);
                branch.rename = true;
                branch.oldName = (() => {
                    const tmp = branchName.split('remotes/origin/');
                    return (tmp.length) ? tmp[1] : tmp[0];
                })();
            }
            if (branch.exist && !branch.name) {
                branch.name = checkName;
            }

        });
        return branch;
    }).then((branch) => {
        if (!branch.rename)
            return branch;

        console.log(`Branch name has changed from '${branch.oldName}' to '${branch.name}'`);
        return _execAsync.call(self, {
            quiet: self.configuration.quiet,
            args: `branch -m ${branch.oldName} ${branch.name}`
        }).then(function () {
            if (branch.hasRemote) {
                console.log(`Renaming branch on origin`);
                return _execAsync.call(self, {
                    quiet: self.configuration.quiet,
                    args: `push origin :${branch.oldName} ${branch.name}`
                });
            }
        }).then(() => {
            return branch;
        });
    });
};

var _createBranch = function () {
    var self = this;
    var branchName = _sanitizeBranchName.apply(self, arguments);
    console.log("Create branch: ", branchName);
    return _branchExists.call(self, branchName).then(function (exist) {
        if (exist) {
            console.log("\texists already");
            return;
        }

        return _execAsync.call(self, {
            quiet: self.configuration.quiet,
            args: 'branch '.concat(branchName) // --track 
        }).then(function () {
            return branchName;
        });

    });
};

var _deleteBranch = function () {
    var self = this;
    var branchName = _sanitizeBranchName.apply(self, arguments);
    console.log("Delete branch: ", branchName);
    return _branchExists.call(self, branchName).then(function (exist) {
        if (!exist) {
            console.log("\tBranch does not exist!");
            return Promise.resolve();
        }
        return _execAsync.call(self, {
            quiet: self.configuration.quiet,
            args: 'branch -D '.concat(branchName)
        });
    });
};

var _deleteBranchRemote = function () {
    var self = this;
    var branchName = _sanitizeBranchName.apply(self, arguments);
    console.log("Delete branch on origin: ", branchName);
    return _branchExists.call(self, branchName).then(function (exist) {
        if (!exist) {
            console.log("\tBranch does not exist!");
            return Promise.resolve();
        }
        if (self.configuration.remoteUrl) {
            return _execAsync.call(self, {
                quiet: self.configuration.quiet,
                args: 'push origin :heads/'.concat(branchName)
            });
        }
    });
};

var _reset = function (toBranch, hard) {
    var self = this;

    var branchName = _sanitizeBranchName(toBranch);
    console.log("Reset: ", branchName, ` - reset ${((hard) ? '--hard' : '')} ${branchName}`);
    return _branchExists.call(self, branchName).then(function (exist) {
        if (!exist)
            console.log("\tBranch does not exist!", branchName);

        return _execAsync.call(self, {
            quiet: self.configuration.quiet,
            args: `reset ${((hard) ? '--hard' : '')} ${branchName}`
        });

    });
};

var _merge = function () {
    var self = this;
    var branchName = _sanitizeBranchName.apply(self, arguments);
    console.log("Merge branch: ", branchName);
    return _branchExists.call(self, branchName).then(function (exists) {
        if (!exists) {
            console.log("\tBranch does not exist!");
            return Promise.resolve();
        }
        return _execAsync.call(self, {
            quiet: self.configuration.quiet,
            args: 'merge --quiet '.concat(branchName)
        });
    });
};

var _hasAddedFiles = function () {
    var self = this;
    return _execAsync.call(self, {
        quiet: self.configuration.quiet,
        args: 'diff --cached --shortstat'
    }).then(function (shortStat) {
        return (shortStat || '').includes('file');
    });
};

var _add = function (files) {
    var self = this;
    var fileNames = Array.isArray(files) ? files : [files];

    // split the files into chunk of 20
    var fileNamesChunks = [];
    var i, j, chunk = 20;
    for (i = 0, j = fileNames.length; i < j; i += chunk) {
        fileNamesChunks.push(fileNames.slice(i, i + chunk));
    }

    return Promise.each(fileNamesChunks, function (fileNamesChunk) {
        return _execAsync.call(self, {
            quiet: self.configuration.quiet,
            args: 'add ' + escape(fileNamesChunk)
        });
    }).then((chunks) => chunks.reduce((acc, val) => acc.concat(val), []));

};

var _delete = function (files) {
    var self = this;
    var fileNames = Array.isArray(files) ? files : [files];

    // split the files into chunk of 20
    var fileNamesChunks = [];
    var i, j, chunk = 20;
    for (i = 0, j = fileNames.length; i < j; i += chunk) {
        fileNamesChunks.push(fileNames.slice(i, i + chunk));
    }

    return Promise.each(fileNamesChunks, function (fileNamesChunk) {
        return _execAsync.call(self, {
            quiet: self.configuration.quiet,
            args: 'rm ' + escape(fileNamesChunk)
        });
    }).then((chunks) => chunks.reduce((acc, val) => acc.concat(val), []));
};


var _addAll = function () {
    var self = this;
    return _execAsync.call(self, {
        quiet: self.configuration.quiet,
        args: 'add --all'
    });
};

var _addDeleted = function () {
    var self = this;
    return _execAsync.call(self, {
        quiet: self.configuration.quiet,
        args: 'add -u'
    });
};

var _commit = function (options) {
    var self = this;

    var opt = {
        author: {
            name: null,
            email: null
        },
        messages: []
    };

    if (typeof options == 'string') {
        opt.messages.push(options);
    } else {
        ObjectAssignDeep(opt, options);
    }

    return Promise.try(function () {

        if (opt.messages.length === 0)
            throw "No  message specified";

    }).then(function () {

        return _hasAddedFiles.call(self);
    }).then(function (filesToCommit) {

        if (!filesToCommit) {
            console.log("No files to be committed. abort commit.");
            return null;
        }

        console.log("Commit : %s", opt.messages.join(', '));

        return tmp.fileAsync({ keep: false }).then(function (tempFile) {
            /*
                create a temp file with the commit message
                > this is the safest way so far to deal with special characters
            */
            return fs.writeFileAsync(tempFile, opt.messages.join('\n'), {
                encoding: 'utf8'
            }).then(function () {
                return tempFile;
            });
        }).then(function (tempFile) {
            // add that file to the commit command
            var cmd = ['commit', '--quiet'];
            cmd.push("--file=".concat(tempFile));
            return cmd;
        }).then(function (cmd) {
            // in case there is an author specified, add it 
            if (opt.author.name) {
                if (opt.author.email) {
                    cmd.push('--author='.concat(escape(opt.author.name.concat(' <'.concat(opt.author.email).concat('>')))));
                } else {
                    cmd.push('--author='.concat(escape(opt.author.name)));
                }
            }
            return cmd;
        }).then(function (cmd) {
            // run the git command
            return _execAsync.call(self, {
                args: cmd.join(' '),
                quiet: self.configuration.quiet
            }).catch(function (e) {
                // TODO: better way to track issues with commit here
                //console.log(e);
            });
        });
    });
};

var _fetch = function (branchName) {
    var self = this;
    return Promise.try(function () {
        if (self.configuration.remoteUrl) {

            return _branchConfig.call(self, branchName).then((branchConfig) => {
                if (branchName !== undefined && (!branchConfig || !branchConfig.hasRemote)) {
                    console.log("cant fetch from a local only branch");
                    return;
                }
                var branch = (branchName !== undefined) ? `origin ${branchName}` : '--all';
                console.log("FETCH ", branch);
                return _execAsync.call(self, {
                    quiet: self.configuration.quiet,
                    args: 'fetch '.concat(branch)
                });
            });

        }
    });
};

var _pull = function (branchName) {
    var self = this;
    return Promise.try(function () {
        if (self.configuration.remoteUrl) {

            return _branchConfig.call(self, branchName).then((branchConfig) => {
                if (branchName !== undefined && (!branchConfig || !branchConfig.hasRemote)) {
                    console.log("cant pull from a local only branch");
                    return;
                }

                var branch = (branchName !== undefined) ? `origin ${branchName}` : '--all';
                console.log(`GIT - PULL: ${branch}`);
                return _execAsync.call(self, {
                    quiet: self.configuration.quiet,
                    args: 'pull '.concat(branch)
                });
            });

        }
    });
};

var _push = function (branchName, force) {
    var self = this;
    /*
        add https support
        git push https: //username:password@myrepository.biz/file.git --all

        in this case 
        https: //username:password@myrepository.biz/file.git replace 
        the 'origin' in 'git push origin --all'
    */
    return Promise.try(function () {
        if (self.configuration.remoteUrl) {

            var branch = (branchName !== undefined) ? `origin ${branchName}` : '--all';
            console.log(`GIT - PUSH: ${branch}`);
            return _execAsync.call(self, {
                quiet: self.configuration.quiet,
                args: `push ${(force === true) ? '--force' : ''} ${branch}`
            }).catch(function (err) {
                console.error("push to remote failed. make sure the ssh key has no passphrase (ssh-keygen -p)");
                console.log(err);
                return err;
            });
        }
    });
};

var _mergeAbort = function () {
    var self = this;
    console.log(`GIT - ABORT MERGE`);
    return _execAsync.call(self, {
        quiet: self.configuration.quiet,
        args: 'merge --abort'
    });
};

module.exports = Git;
