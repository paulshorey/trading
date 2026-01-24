const { createNextJestConfig } = require('@lib/config/jest/next-app')

module.exports = createNextJestConfig({
  testEnvironment: 'node',
})
