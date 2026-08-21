const path = require('path')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
  entry: './src/app.js',
  mode: 'development',
  devtool: 'source-map',
  module: {
    rules: [
      {
        // 3D models (the converted skeleton ghost, and any future ones)
        test: /\.(glb|gltf)$/,
        type: 'asset/resource',
        generator: { filename: 'assets/models/[name][ext]' },
      },
      {
        // Textures for those models
        test: /\.(png|jpe?g)$/,
        type: 'asset/resource',
        generator: { filename: 'assets/textures/[name][ext]' },
      },
    ],
  },
  output: {
    path: path.resolve(__dirname, '../dist'),
    filename: 'bundle.[contenthash].js',
    publicPath: './',
  },
  devServer: {
    static: path.resolve(__dirname, '../dist'),
    host: '0.0.0.0',
    port: 8080,
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', 'localhost'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '../src/index.html'),
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, '../node_modules/@8thwall/engine-binary/dist'),
          to: 'external/xr',
        },
        {
          from: path.resolve(__dirname, '../src/sw.js'),
          to: 'sw.js',
        },
        {
          from: path.resolve(__dirname, '../src/manifest.json'),
          to: 'manifest.json',
        },
        {
          from: path.resolve(__dirname, '../src/assets/icons'),
          to: 'assets/icons',
        },
      ],
    }),
  ],
}
