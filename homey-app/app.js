'use strict';

const Homey = require('homey');

class FlexitApp extends Homey.App {

  async onInit() {
    this.log('Flexit Nordic app initialized');
  }

}

module.exports = FlexitApp;
