'use strict'

const js = require('@eslint/js')
const mocha = require('eslint-plugin-mocha').default
const globals = require('globals')

module.exports = [
  {
    ignores: [
      'out/**',
      'coverage/**',
      'dbfiles/**',
      'supervisor/**',
      '.nyc_output/**'
    ]
  },
  js.configs.recommended,
  {
    plugins: {
      mocha
    },
    languageOptions: {
      ecmaVersion: 8,
      sourceType: 'module',
      globals: Object.assign({}, globals.node, globals.mocha)
    },
    rules: {
      'no-prototype-builtins': 'off',
      'mocha/no-exclusive-tests': 'error',
      'no-unused-vars': ['error', { args: 'none' }],
      'no-console': 'off',
      indent: ['error', 2],
      'linebreak-style': ['error', 'unix'],
      semi: ['error', 'never']
    }
  }
]
