/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subject line: 72 chars max (industry convention; design.md §12 calls this out)
    'header-max-length': [2, 'always', 72],
    // Type-case: lowercase only (Angular convention)
    'type-case': [2, 'always', 'lowercase'],
    // Subject-case: lowercase first letter
    'subject-case': [
      2,
      'never',
      ['sentence-case', 'start-case', 'pascal-case', 'upper-case'],
    ],
    // Body / footer line length (auto-wrap)
    'body-max-line-length': [2, 'always', 100],
    'footer-max-line-length': [2, 'always', 100],
  },
};