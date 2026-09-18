import ObjectID from "bson-objectid";

export const generateObjectId = () => new ObjectID().toHexString();
