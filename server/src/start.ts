// Production entry point (npm start): forces NODE_ENV=production before anything else loads.
process.env.NODE_ENV = process.env.NODE_ENV === 'test' ? 'test' : 'production';
require('./index');
