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
        // XRExtras helpers (loading screen, full-window canvas, error handling).
        // NOTE: verify this matches the actual published package name/path in
        // https://github.com/8thwall/8thwall/tree/main/packages/xrextras — the
        // monorepo is young and package names may shift. If it differs, update
        // this `from` path and the <script> tag in src/index.html to match.
        {
          from: path.resolve(__dirname, '../node_modules/@8thwall/xrextras/dist'),
          to: 'external/xrextras',
          noErrorOnMissing: true,
        },
      ],
    }),
  ],
}
