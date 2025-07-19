// Example production security configuration
const isProduction = process.env.NODE_ENV === 'production';

const getHelmetConfig = () => {
  const baseConfig = {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
      useDefaults: false,
    },
  };

  if (isProduction) {
    // Enable production security headers
    return {
      ...baseConfig,
      contentSecurityPolicy: {
        ...baseConfig.contentSecurityPolicy,
        directives: {
          ...baseConfig.contentSecurityPolicy.directives,
          upgradeInsecureRequests: [], // Force HTTPS in production
        },
      },
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
      },
      crossOriginOpenerPolicy: { policy: "same-origin" },
      originAgentCluster: true,
    };
  }

  // Development config (current settings)
  return {
    ...baseConfig,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    hsts: false,
  };
};

module.exports = { getHelmetConfig };