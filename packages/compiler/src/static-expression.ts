import { parseExpressionAt } from "acorn";

export type StaticValue =
  | null
  | string
  | number
  | boolean
  | StaticValue[]
  | { [key: string]: StaticValue };

interface ExpressionNode {
  type: string;
  start: number;
  end: number;
  value?: unknown;
  elements?: Array<ExpressionNode | null>;
  properties?: PropertyNode[];
  operator?: string;
  argument?: ExpressionNode;
}

interface PropertyNode extends ExpressionNode {
  kind?: string;
  method?: boolean;
  computed?: boolean;
  shorthand?: boolean;
  key?: ExpressionNode & { name?: string };
  value?: ExpressionNode;
}

function evaluateNode(node: ExpressionNode): StaticValue {
  switch (node.type) {
    case "Literal": {
      if (
        node.value === null ||
        typeof node.value === "string" ||
        typeof node.value === "number" ||
        typeof node.value === "boolean"
      ) {
        if (typeof node.value === "number" && !Number.isFinite(node.value)) {
          throw new Error("Numbers must be finite");
        }
        return node.value;
      }
      throw new Error("Only string, number, boolean and null literals are allowed");
    }
    case "ArrayExpression":
      return (node.elements ?? []).map((element) => {
        if (element === null) {
          throw new Error("Array holes are not allowed");
        }
        return evaluateNode(element);
      });
    case "ObjectExpression": {
      const value: Record<string, StaticValue> = {};
      for (const property of node.properties ?? []) {
        if (
          property.type !== "Property" ||
          property.kind !== "init" ||
          property.method ||
          property.computed ||
          property.shorthand
        ) {
          throw new Error("Only plain object properties are allowed");
        }
        const keyNode = property.key;
        const valueNode = property.value;
        if (!keyNode || !valueNode) {
          throw new Error("Invalid object property");
        }
        let key: string;
        if (keyNode.type === "Identifier" && keyNode.name) {
          key = keyNode.name;
        } else if (
          keyNode.type === "Literal" &&
          (typeof keyNode.value === "string" || typeof keyNode.value === "number")
        ) {
          key = String(keyNode.value);
        } else {
          throw new Error("Object keys must be identifiers, strings or numbers");
        }
        if (Object.hasOwn(value, key)) {
          throw new Error(`Duplicate object key: ${key}`);
        }
        value[key] = evaluateNode(valueNode);
      }
      return value;
    }
    case "UnaryExpression": {
      if (!node.argument) {
        throw new Error("Invalid unary expression");
      }
      const argument = evaluateNode(node.argument);
      if (node.operator === "-" && typeof argument === "number") {
        return -argument;
      }
      if (node.operator === "+" && typeof argument === "number") {
        return argument;
      }
      if (node.operator === "!" && typeof argument === "boolean") {
        return !argument;
      }
      throw new Error(`Unary operator ${node.operator ?? ""} is not allowed here`);
    }
    default:
      throw new Error(
        `Expression type ${node.type} is not allowed; use JSON-compatible literals`,
      );
  }
}

export function evaluateStaticExpression(source: string): StaticValue {
  const expression = parseExpressionAt(source, 0, {
    ecmaVersion: "latest",
  }) as ExpressionNode;
  if (source.slice(expression.end).trim() !== "") {
    throw new Error("Unexpected content after expression");
  }
  return evaluateNode(expression);
}
