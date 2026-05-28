const axios = require("axios");
class NasaClientWithRetry {
  constructor(config) {
    this.baseURL = config.baseURL;
    this.timeout = config.timeout;
    this.apiKey = config.apiKey;
  }

  async fetchKpWindow(
    startDate,
    endDate,
    retryCount = 0,
    endpoint = "DONKI/GST"
  ) {
    const maxRetries = 4;
    const delay = 500 * Math.pow(2, retryCount);

    try {
      console.log(
        `[Correlation: ${Date.now()}] Tentativa ${retryCount + 1}/${maxRetries}`
      );

      const params = { api_key: this.apiKey };
      if (startDate != null) params.start_date = startDate;
      if (endDate != null) params.end_date = endDate;

      const response = await axios.get(`${this.baseURL}/${endpoint}`, {
        params,
        timeout: this.timeout,
      });

      return response.data;
    } catch (error) {
      const shouldRetry = this.isTransientError(error);

      if (shouldRetry && retryCount < maxRetries - 1) {
        console.log(`Falha transitória, tentando novamente em ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchKpWindow(startDate, endDate, retryCount + 1);
      }

      throw error;
    }
  }

  isTransientError(error) {
    if (error.code === "ECONNABORTED" || error.code === "ENOTFOUND") {
      return true; // Timeout ou network error
    }

    if (error.response) {
      const status = error.response.status;
      return status === 429 || (status >= 500 && status <= 599);
    }

    return false;
  }
}

module.exports = { NasaClientWithRetry };
