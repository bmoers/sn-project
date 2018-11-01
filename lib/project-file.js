var Promise = require('bluebird');

var fs = Promise.promisifyAll(require("fs-extra"));
var deleteEmpty = Promise.promisifyAll(require('delete-empty'));
var path = require("path");

const promiseFor = Promise.method(function (condition, action, value) {
    if (!condition(value))
        return value;
    return action(value).then(promiseFor.bind(null, condition, action));
});

function getDirName(dir) {
    try {
        if (fs.lstatSync(dir).isDirectory()) {
            return dir;
        }
        return path.dirname(dir);
    } catch (ignore) {
        const parsed = path.parse(dir);
        if (parsed.ext)
            return parsed.dir;
        return path.join(parsed.dir, parsed.name);
    }
}

function copyFileAsync(source, target, options) {
    return fs.copyAsync(source, target, options);
}
exports.copyFileAsync = copyFileAsync;

function mkdirpAsync(fullPath) {
    return fs.mkdirpAsync(getDirName(fullPath));
}
exports.mkdirpAsync = mkdirpAsync;

function writeFileAsync(fullFilePath, contents, options) {
    return fs.mkdirpAsync(getDirName(fullFilePath)).then(function () {
        // append newline if there is none : "It's not about adding an extra newline at the end of a file, it's about not removing the newline that should be there."
        return fs.writeFileAsync(fullFilePath, (!(/\n$/.test(contents))) ? `${contents}\n` : contents, Object.assign({
                encoding: 'utf8'
            },
            options));
    });
}
exports.writeFileAsync = writeFileAsync;

function move(from, to) {
    return fs.move(from, to);
}
exports.move = move;

function renameFileAsync(from, to) {
    return fs.renameAsync(from, to);
}
exports.renameFileAsync = renameFileAsync;

function readFileAsync(filePath) {
    return fs.readFileAsync(path.join(filePath), {
        encoding: 'utf8'
    });
}
exports.readFileAsync = readFileAsync;

function exists(fullFilePath) {
    return fs.statAsync(fullFilePath).then(function () {
        return true;
    }).catch({
        code: 'ENOENT'
        }, function () {
        return false;
    });
}
exports.exists = exists;

function deleteEmptyDirAsync(fullFilePath) {
    return deleteEmpty(getDirName(fullFilePath));
}
exports.deleteEmptyDirAsync = deleteEmptyDirAsync;


function deleteEmptyDirUpwards(fullFilePath) {
    return promiseFor(function (next) {
        return (next);
    }, (dir) => {
        return deleteEmptyDirAsync(dir).then((res) => {
            if (!res.length)
                return false;
            return path.resolve(dir, '../');
        });
    }, fullFilePath);
}
exports.deleteEmptyDirUpwards = deleteEmptyDirUpwards;

function deleteFileAsync(fullFilePath, removeEmptyDirectory) {

    return exists(fullFilePath).then(function (exists) {
        if (exists) {
            return fs.unlinkAsync(fullFilePath).catch(function (err) {
                console.error(err);
            });
        }
    }).then(function () {
        if (removeEmptyDirectory === true)
            return deleteEmptyDirAsync(fullFilePath);
    }).then(function () {
        return true;
    });
}
exports.deleteFileAsync = deleteFileAsync;