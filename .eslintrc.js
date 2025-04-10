module.exports = {
  env: {
    node: true // Node.js globals (e.g., require, process)
  },
  parserOptions: {
    sourceType: 'commonjs', // For require()
    ecmaVersion: 'latest' // Modern JS features
  },
  extends: [
    'eslint:recommended', // Base ESLint rules
    'airbnb-base' // Airbnb style guide
  ],
  plugins: [
    'import' // For require/import rules
  ],
  rules: {
    // Strict error prevention
    'no-unused-vars': ['error', { vars: 'all', args: 'after-used', ignoreRestSiblings: false }],
    'no-undef': 'error',
    'no-dupe-keys': 'error',
    eqeqeq: ['error', 'always'],
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // Code style (Airbnb-inspired)
    indent: ['error', 2, { SwitchCase: 1 }],
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'always'],
    'comma-dangle': ['error', 'never'],
    'object-curly-spacing': ['error', 'always'],
    'array-bracket-spacing': ['error', 'never'],

    // Import rules
    'import/no-unresolved': 'error',
    'import/order': ['error', { groups: [['builtin', 'external', 'internal']] }]
  },
  ignorePatterns: ['views/*.hbs', 'public/*.css', 'studygroup.db'] // Exclude non-JS files
};
