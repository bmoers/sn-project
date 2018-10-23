var Promise = require('bluebird');

var fs = Promise.promisifyAll(require("fs-extra"));
var deleteEmpty = require('delete-empty');
var path = require("path");

var getDirName = path.dirname;

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
        return fs.writeFileAsync(fullFilePath, contents, Object.assign({
                encoding: 'utf8'
            },
            options));
    });
}
exports.writeFileAsync = writeFileAsync;

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
    return new Promise(function (resolve, reject) {
        deleteEmpty(getDirName(fullFilePath), resolve);
    });
}

exports.deleteEmptyDirAsync = deleteEmptyDirAsync;

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