if (!customElements.get('google-assistant-entity-console-panel')) {
  class GoogleAssistantEntityConsolePanel extends HTMLElement {
    setConfig(config) {
      this._config = config;
    }

    set hass(hass) {
      if (!this._iframe) {
        this._iframe = document.createElement('iframe');
        this._iframe.style.width = '100%';
        this._iframe.style.height = '100%';
        this._iframe.style.border = '0';
        this._iframe.style.display = 'block';
        this.appendChild(this._iframe);
      }
      // Update the src only once
      if (!this._iframe.src) {
        const token = hass.auth.accessToken;
        const ver = (this._config && this._config.version) || Date.now();
        this._iframe.src = `/google_assistant_entity_console/static/index.html?token=${encodeURIComponent(token)}&v=${ver}`;
      }
    }
  }
  customElements.define('google-assistant-entity-console-panel', GoogleAssistantEntityConsolePanel);
}
