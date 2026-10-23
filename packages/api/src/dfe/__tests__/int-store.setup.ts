// Points the integration suite at the store DFE_INT_MONGO_URI names. It runs
// after dotenv loads .env.test with override on, which replaces a MONGO_URI set
// any earlier.
const storeUri = process.env.DFE_INT_MONGO_URI;
if (storeUri) {
  process.env.MONGO_URI = storeUri;
}

export {};
