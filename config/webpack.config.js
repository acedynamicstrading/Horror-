const path = require('path')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
  entry: './src/app.js',
  mode: 'development',
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, '../dist'),
    filename: 'bundle.js',
    // Relative (not absolute "/") so this works whether it's served from
    // the domain root or a GitHub Pages project subpath like
    // https://<user>.github.io/<repo>/.
    publicPath: './',
  },
  devServer: {
    static: path.resolve(__dirname, '../dist'),
    host: '0.0.0.0',
    port: 8080,
    // Required so ngrok's tunnel hostname isn't rejected by webpack-dev-server.
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', 'localhost'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '../src/index.html'),
    }),
    new CopyWebpackPlugin({
      patterns: [
        // The 8th Wall engine (includes the binary-licensed SLAM chunk).
        {
          from: path.resolve(__dirname, '../node_modules/@8thwall/engine-binary/dist'),
          to: 'external/xr',
        },
        // Service worker + manifest must ship as plain files at the output
        // root (not bundled through src/app.js) so the browser can register
        // sw.js directly and find manifest.json via the <link> tag.
        {
          from: path.resolve(__dirname, '../src/sw.js'),
          to: 'sw.js',
        },
        {
          from: path.resolve(__dirname, '../src/manifest.json'),
          to: 'manifest.json',
        },
      ],
    }),
  ],
}
