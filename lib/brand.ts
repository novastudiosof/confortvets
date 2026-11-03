export const PRODUCT_NAME = "ConfortVets";
export const PRODUCT_SLOGAN = "Más tiempo para cuidar.";

export const DEVELOPER_NAME = "NovaStudio";
/** WhatsApp de NovaStudio (solo dígitos con indicativo de país). */
export const DEVELOPER_WHATSAPP = "573193034610";

export function developerWhatsAppLink(message: string): string {
  return `https://wa.me/${DEVELOPER_WHATSAPP}?text=${encodeURIComponent(message)}`;
}

export const DEVELOPER_CONTACT_MESSAGE = `Hola ${DEVELOPER_NAME}, quiero información sobre ${PRODUCT_NAME}.`;
export const RENEW_MEMBERSHIP_MESSAGE = `Hola ${DEVELOPER_NAME}, quiero actualizar mi membresía de ${PRODUCT_NAME}.`;

/** Mensaje para pedir información de un módulo que el consultorio aún no tiene. */
export function moduleInfoMessage(business: string, professional: string | null, moduleName: string): string {
  const who = professional && professional.trim() && professional.trim() !== business.trim() ? `${business} (${professional.trim()})` : business;
  return `Hola ${DEVELOPER_NAME}, soy de ${who}. Quiero información sobre el módulo «${moduleName}» de ${PRODUCT_NAME}.`;
}
