import { createPayPalProvider } from './paypal.js';
import { createPesaPalProvider } from './pesapal.js';

// Active providers: PesaPal (hosted checkout; PesaPal decides which payment methods the customer sees) and PayPal.
// The customer picks explicitly; we never infer the provider from IP address.
export const createProviders = (options = {}) => ({ pesapal: createPesaPalProvider(options), paypal: createPayPalProvider(options) });
