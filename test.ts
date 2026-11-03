import { jsPDF } from "jspdf";
const doc = new jsPDF();
console.log("saveGraphicsState", typeof doc.saveGraphicsState);
console.log("setGState", typeof doc.setGState);
console.log("GState from doc", typeof (doc as any).GState);
console.log("GState from jsPDF", typeof (jsPDF as any).GState);
console.log("doc.GState", typeof doc.GState);
