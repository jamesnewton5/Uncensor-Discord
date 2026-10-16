/**
 * @name AgeVerificationBypass
 * @author Enzio
 * @version 1.0.0
 * @description Remove age verification pop-up when unhiding obscured images.
 */

module.exports = class AgeVerificationBypass {
    constructor() {
        this.BdApi = new BdApi("AgeVerificationBypass");
        this.MODULE_IDENTIFIER = Symbol();

        this.bearerToken = undefined;
        this.bearerTokenValid = false;
    }

    // Called when the plugin is first loaded into memory
    load() {
    }

    // Called when the user toggles the plugin ON in settings
    start() {
        this.insertGetTokenScript();
        this.initialise();
    }

    stop() {
        this.removeGetTokenScript();
        const documentPrototype = document.__originalPrototype__;
        if (documentPrototype === undefined) return;
        Object.setPrototypeOf(document, documentPrototype);
    }

    removeGetTokenScript() {
        webpackChunkdiscord_app.some((moduleArray, index) => {
            if (moduleArray[0] !== this.MODULE_IDENTIFIER) return false;
            moduleArray.splice(index, 1);
            return true;
        });
    }

    insertGetTokenScript() {
        this.removeGetTokenScript();

        webpackChunkdiscord_app.push([
            [this.MODULE_IDENTIFIER],
            {},
            (runtime) => {
                if (this.bearerTokenValid === true) return;
                try {
                    Object.values(runtime.c).some((e) => {
                        if (!e.exports?.setToken) return false;
                        this.bearerToken = e.exports.getToken();
                        this.bearerTokenValid = true;
                        return true;
                    });
                } catch { }
            }]
        );
    }

    showError(message) {
        this.BdApi.UI.showToast("Error: " + message, { type: "error" });
    }

    getMessageData(serverId, channelId, messageId) {
        const thisRef = this;
        return new Promise((resolve, reject) => {
            fetch(`https://discord.com/api/v9/channels/${channelId}/messages?around=${messageId}&limit=1`, {
                "headers": {
                    "accept": "*/*",
                    "authorization": `${thisRef.bearerToken}`,
                    "priority": "u=1, i",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-origin"
                },
                "referrer": `https://discord.com/channels/${serverId}/${channelId}`,
                "body": null,
                "method": "GET",
                "mode": "cors",
                "credentials": "include"
            }).then((response) => {
                if (response.status === 401) {
                    // Not authorised
                    thisRef.bearerTokenValid = false;
                    return reject("Bearer token invalid");
                }
                if (!response.ok) return reject("Bad response");

                response.json().then((messages) => {
                    const messageData = messages[0];
                    if (messageData === undefined) reject("Could not get message data");
                    else resolve(messageData);
                }).catch(() => {
                    reject("Bad JSON");
                });
            }).catch((error) => {
                reject(error);
            });
        });
    }

    initialise() {
        const thisRef = this;
        const documentPrototype = document.__originalPrototype__ ?? Object.getPrototypeOf(document);

        const proxy = new Proxy(documentPrototype, {
            get(target, propertyKey, receiver) {
                if (propertyKey === "__originalPrototype__") return documentPrototype;
                const value = Reflect.get(target, propertyKey, receiver);
                if (propertyKey === "createElement") return (...args) => {
                    const element = value.call(receiver, args);
                    if (args[0] !== "div" || !thisRef.bearerTokenValid) return element;

                    queueMicrotask(() => {
                        if (element.className) return thisRef.onElementInitialised(element);

                        let _className = "";
                        Object.defineProperty(element, "className", {
                            get() { return _className; },
                            set(value) {
                                _className = value;
                                queueMicrotask(() => thisRef.onElementInitialised(element));
                                return true;
                            }
                        })

                    });
                    return element;
                }
                return value;
            }
        });

        Object.setPrototypeOf(document, proxy);
    }

    onElementInitialised(element) {
        if (!element.className.startsWith("explicitContentWarning")) return;
        const spoilerContent = element.parentElement;

        // Get message container
        let messageContainer = spoilerContent;
        while (messageContainer !== undefined && !(messageContainer.id ?? "").startsWith("chat-messages")) {
            messageContainer = messageContainer.parentElement;
        }
        if (messageContainer === undefined) return console.error("Could not get message container");

        // Format: chat-messages-12345-12345
        const id = messageContainer.id;
        const [channelId, messageId] = id.replace("chat-messages-", "").split("-");
        const serverId = document.URL.split("channels/")[1];
        if (serverId === undefined || channelId === undefined || messageId === undefined) throw new Error("Couldn't get message ID")

        // Get show/hide button/s
        const buttons = Array.from(spoilerContent.querySelectorAll("div")).filter((element) => {
            return element.className.startsWith("obscureHoverButton");
        });
        if (buttons.length === 0) {
            console.error("Could not find button");
            return;
        } else this.removeEventListenersFromButtons(buttons);

        this.getMessageData(serverId, channelId, messageId).then((messageData) => {
            let buttonIndex = 0;
            for (const attachment of [...messageData.attachments ?? [], ...messageData.embeds ?? []]) {
                if (attachment.flags !== 16) continue;
                const url = ("image" in attachment) ? attachment.image.proxy_url : (attachment.proxy_url ?? attachment.url);
                if (url === undefined) {
                    console.error("URL undefined");
                    continue;
                }
                let button = buttons[buttonIndex];
                if (button === undefined) {
                    console.error("Could not find button from array at index", buttonIndex);
                    button = buttons.at(-1);
                }
                buttonIndex++;


                const imagePreview = button.parentElement.parentElement;
                const imagePreviewChildNodes = Array.from(imagePreview.children);
                const warning = imagePreviewChildNodes.find((element) => element.className.startsWith("explicitContentWarning"));
                let innerContainer = imagePreviewChildNodes.find((element) => element.className.startsWith("spoilerInnerContainer"));
                innerContainer.style.backgroundRepeat = "no-repeat";
                innerContainer.style.backgroundSize = "cover";

                Array.from(innerContainer.children).some((element) => {
                    if (!element.className.startsWith("embedFull")) return false;
                    innerContainer = element;
                    return true;
                });

                let state = warning.style.visibility === "visible";

                button.onclick = () => {
                    state = !state;
                    warning.style.visibility = state ? "hidden" : "visible";
                    innerContainer.style.backgroundImage = state ? `url('${url}')` : "";
                }
            }
        }).catch((error) => {
            console.warn(error);
        });
    }

    removeEventListenersFromButtons(buttonArray) {
        for (let i = 0; i < buttonArray.length; i++) {
            const button = buttonArray[i];
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
            buttonArray[i] = newButton;
        }
    }
};

