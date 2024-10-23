module.exports = {
  extends: ['mantine', 'plugin:@next/next/recommended', 'plugin:jest/recommended'],
  plugins: ['testing-library', 'jest'],
  overrides: [
    {
      files: ['**/?(*.)+(spec|test).[jt]s?(x)'],
      extends: ['plugin:testing-library/react'],
    },
  ],
  parserOptions: {
    project: './tsconfig.json',
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    'import/extensions': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'react/no-unescaped-entities': 'off',
    'no-console': 'off',
    '@typescript-eslint/no-use-before-define': 'off',
    'no-unused-vars': ['warn'],
    'etc/no-commented-out-code': 'off',
    'array-callback-return': 'off',
    'no-plusplus': 'off',
    'no-empty-pattern': 'off',
    'func-names': 'off',
    'no-else-return': 'off',
    'prefer-destructuring': 'off',
    'no-restricted-syntax': 'off',
    'guard-for-in': 'off',
    'no-continue': 'off',
  },
};
