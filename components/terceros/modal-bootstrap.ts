type BootstrapModalInstance = {
  show: () => void;
  hide: () => void;
};

type BootstrapModalApi = {
  getOrCreateInstance: (element: Element) => BootstrapModalInstance;
};

declare global {
  interface Window {
    bootstrap?: { Modal?: BootstrapModalApi };
  }
}

function obtenerElemento(id: string): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.getElementById(id);
}

function obtenerApi(): BootstrapModalApi | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.bootstrap?.Modal ?? null;
}

export function mostrarModal(id: string): void {
  const elemento = obtenerElemento(id);
  if (!elemento) {
    return;
  }
  const api = obtenerApi();
  if (api) {
    api.getOrCreateInstance(elemento).show();
    return;
  }
  elemento.classList.add("show", "d-block");
  elemento.style.display = "block";
  elemento.removeAttribute("aria-hidden");
  document.body.classList.add("modal-open");
  if (!document.querySelector(".modal-backdrop")) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop fade show";
    document.body.appendChild(backdrop);
  }
}

export function ocultarModal(id: string): void {
  const elemento = obtenerElemento(id);
  if (!elemento) {
    return;
  }
  const api = obtenerApi();
  if (api) {
    api.getOrCreateInstance(elemento).hide();
    return;
  }
  elemento.classList.remove("show", "d-block");
  elemento.style.display = "";
  elemento.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  document.querySelector(".modal-backdrop")?.remove();
  elemento.dispatchEvent(new Event("hidden.bs.modal"));
}

export function alOcultarModal(id: string, callback: () => void): () => void {
  const elemento = obtenerElemento(id);
  if (!elemento) {
    return () => {};
  }
  elemento.addEventListener("hidden.bs.modal", callback);
  return () => elemento.removeEventListener("hidden.bs.modal", callback);
}
