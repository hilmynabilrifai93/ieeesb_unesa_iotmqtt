import mqtt from 'mqtt';
import { mqttConfig } from '../config.local.js';
import { MQTT_SUBSCRIPTIONS } from '../src/device-store.js';

const timeout = setTimeout(() => {
  console.error('Verifikasi MQTT timeout.');
  client.end(true);
  process.exitCode = 1;
}, 12000);

const client = mqtt.connect(mqttConfig.url, {
  username: mqttConfig.username,
  password: mqttConfig.password,
  clean: true,
  connectTimeout: 5000,
  reconnectPeriod: 0,
  clientId: `web_ieee_verify_${Date.now()}`,
  protocolId: 'MQTT',
  protocolVersion: 4,
});

client.on('connect', () => {
  client.subscribe(MQTT_SUBSCRIPTIONS, { qos: 0 }, (subscribeError) => {
    if (subscribeError) {
      console.error(`Subscribe gagal: ${subscribeError.message}`);
      client.end(true);
      process.exitCode = 1;
      return;
    }
    clearTimeout(timeout);
    console.log(`Verifikasi MQTT berhasil. Subscribe: ${MQTT_SUBSCRIPTIONS.join(', ')}`);
    client.end(false);
  });
});

client.on('error', (error) => {
  console.error(`Koneksi MQTT gagal: ${error.message}`);
});
