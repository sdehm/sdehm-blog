document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".prose pre").forEach(function (pre) {
    var code = pre.querySelector("code");
    if (!code) return;

    var wrapper = document.createElement("div");
    wrapper.className = "code-block";
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    var button = document.createElement("button");
    button.type = "button";
    button.className = "code-block__copy";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code");
    button.setAttribute("aria-live", "polite");
    wrapper.appendChild(button);

    var resetTimer;
    button.addEventListener("click", async function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        console.error("Clipboard API is unavailable");
        button.textContent = "Copy unavailable";
        button.setAttribute("aria-label", "Copy unavailable");
      } else {
        try {
          await navigator.clipboard.writeText(code.textContent);
          button.textContent = "Copied";
          button.setAttribute("aria-label", "Code copied");
        } catch (error) {
          console.error("Could not copy code:", error);
          button.textContent = "Copy failed";
          button.setAttribute("aria-label", "Copy failed");
        }
      }

      clearTimeout(resetTimer);
      resetTimer = setTimeout(function () {
        button.textContent = "Copy";
        button.setAttribute("aria-label", "Copy code");
      }, 2000);
    });
  });
});
