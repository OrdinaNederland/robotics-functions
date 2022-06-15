import { ComputerVisionClient } from "@azure/cognitiveservices-computervision";
import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { ApiKeyCredentials } from "@azure/ms-rest-js";
import HTTP_CODES from "http-status-enum";
import * as multipart from "parse-multipart";

const BYTE = 1;
const KBYTE = 1024 * BYTE;
const MBYTE = 1024 * KBYTE;

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png"];
const MAX_FILE_SIZE = 6 * MBYTE;

const validateAndStorePicture: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<any> {
  context.log("upload HTTP trigger function processed a request.");

  try {
    validateRequest(req);

    const filePath = uploadPhoto(req, req.headers["content-type"], context);
    context.res.body = await gatherComputerVisionResult(filePath);
    context.res.contentType = "application/json";
  } catch (err) {
    context.log.error(err.message);
    {
      context.res.body = `${err.message}`;
      context.res.status = HTTP_CODES.INTERNAL_SERVER_ERROR;
    }
  }
  return context.res;
};

const validateRequest = (req: HttpRequest) => {
  if (!req.query?.robotName) {
    throw new Error(`robotName is not defined`);
  }

  // `filename` is required property to use multi-part npm package
  if (!req.query?.filename) {
    throw new Error(`filename is not defined`);
  }

  if (!req.body || !req.body.length) {
    throw new Error(`Request body is not defined`);
  }

  const contentType = req.headers["content-type"];

  if (!req.headers || !contentType) {
    throw new Error(`Content type is not sent in header 'content-type'`);
  }

  if (
    process?.env?.Environment === "Production" &&
    (!process?.env?.AzureWebJobsStorage ||
      process?.env?.AzureWebJobsStorage.length < 10)
  ) {
    throw Error(
      "Storage isn't configured correctly - get Storage Connection string from Azure portal"
    );
  }
};

const uploadPhoto = (
  req: HttpRequest,
  contentType: string,
  context: Context
): string => {
  // Each chunk of the file is delimited by a special string
  const bodyBuffer = Buffer.from(req.body);
  const boundary = multipart.getBoundary(contentType);
  const parts = multipart.Parse(bodyBuffer, boundary);

  // The file buffer is corrupted or incomplete ?
  if (!parts?.length) {
    context.res.body = `File buffer is incorrect`;
    context.res.status = HTTP_CODES.BAD_REQUEST;
  }

  // filename is a required property of the parse-multipart package
  if (parts[0]?.filename)
    console.log(`Original filename = ${parts[0]?.filename}`);
  if (parts[0]?.type) console.log(`Content type = ${parts[0]?.type}`);
  if (parts[0]?.data?.length) console.log(`Size = ${parts[0]?.data?.length}`);

  // check for allowed file type
  const isAllowedContentType = ALLOWED_CONTENT_TYPES.includes(parts[0]?.type);
  if (!isAllowedContentType) {
    throw new Error(
      `Content type is not in allowed set: ${ALLOWED_CONTENT_TYPES.join(", ")}`
    );
  }

  // check for allowed file size
  if (parts[0]?.data?.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds limit of ${MAX_FILE_SIZE / MBYTE}MB`);
  }

  context.bindings.storage = parts[0]?.data;

  return `https://roboticastorage.blob.core.windows.net/${req.query?.robotName}/${req.query?.filename}`;
};

const gatherComputerVisionResult = async (filePath: string) => {
  const key = process.env["CognitiveApiKey"]; // not filled in?
  const endpoint = process.env["CognitiveApiUrl"]; // not filled in?

  const computerVisionClient = new ComputerVisionClient(
    // @ts-ignore
    new ApiKeyCredentials({ inHeader: { "Ocp-Apim-Subscription-Key": key } }),
    endpoint
  );

  return computerVisionClient.detectObjects(filePath);
};

const httpTrigger: AzureFunction = validateAndStorePicture;

export default httpTrigger;
