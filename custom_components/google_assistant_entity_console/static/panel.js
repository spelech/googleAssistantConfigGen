class GoogleAssistantEntityConsolePanel extends HTMLElement {
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
      this._iframe.src = `/google_assistant_entity_console/static/index.html?token=${encodeURIComponent(token)}`;
    }
  }
}
customElements.define('google-assistant-entity-console-panel', GoogleAssistantEntityConsolePanel);
