/**
 * @type {import('electron-builder').Configuration}
 */
const config = {
  appId: 'com.dimdasci.pdf-translator',
  productName: 'PDF Translator',
  directories: {
    output: 'release',
  },
  files: [
    'dist/**/*',
    'dist-electron/**/*',
  ],
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'dir', arch: ['arm64'] },
    ],
    category: 'public.app-category.productivity',
    identity: null, // Disable code signing
  },
  dmg: {
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },
}

module.exports = config
