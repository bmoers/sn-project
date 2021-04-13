module.exports = {
    'env': {
        'es6': true,
        'commonjs': true,
        'node': true
    },
    'extends': 'eslint:recommended',
    'parserOptions': {
        'ecmaVersion': 2018
    },
    'rules': {
        'indent': [
            'error',
            4
        ],
        'no-console': 'off',
        'no-unused-vars': 'warn',
        'linebreak-style': [
            'warn',
            'unix'
        ],
        'quotes': [
            'warn',
            'single'
        ],
        'semi': [
            'error',
            'always'
        ],
        "no-control-regex": 0
    }
};
