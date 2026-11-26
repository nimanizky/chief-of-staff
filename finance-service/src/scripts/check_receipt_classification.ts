import { strict as assert } from "node:assert";
import { applyPersonalClassificationOverride } from "../domains/receipts/receipt-classification.js";

const defaultDecision = applyPersonalClassificationOverride("food", "Unknown Merchant", "General purchase");
assert.equal(defaultDecision.finalClassification, "food");
assert.equal(defaultDecision.classificationSource, "mistral");
assert.equal(defaultDecision.modelClassification, "food");

const overrideDecision = applyPersonalClassificationOverride("nonfood", "DBesto CS Fried Chicken", "Jakarta Selatan");
assert.equal(overrideDecision.finalClassification, "food");
assert.equal(overrideDecision.classificationSource, "personal_override");
assert.equal(overrideDecision.matchedOverride, "dbesto");
assert.equal(overrideDecision.modelClassification, "nonfood");

const fallbackDecision = applyPersonalClassificationOverride("mobility", "Unknown Merchant", "No matching override");
assert.equal(fallbackDecision.finalClassification, "mobility");
assert.equal(fallbackDecision.classificationSource, "mistral");

const incomeDecision = applyPersonalClassificationOverride("income", "BCA Transfer", "Transfer received");
assert.equal(incomeDecision.finalClassification, "income");
assert.equal(incomeDecision.classificationSource, "mistral");

const invalidDecision = applyPersonalClassificationOverride("not-a-category", "Unknown Merchant", "No matching override");
assert.equal(invalidDecision.finalClassification, "nonfood");
assert.equal(invalidDecision.classificationSource, "fallback");
assert.equal(invalidDecision.modelClassification, "not-a-category");

console.log("receipt classification checks passed");
