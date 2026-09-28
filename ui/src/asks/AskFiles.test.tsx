import {afterEach, describe, it, mock} from "bun:test";
import type {AskFileRef, FilesAskInput} from "@terreno/blocks";
import {act, fireEvent, waitFor, within} from "@testing-library/react-native";
import {assert} from "chai";

import {FilePickerButton, type FilePickerButtonProps, type SelectedFile} from "../FilePickerButton";
import {renderWithTheme} from "../test-utils";
import {AskCard, type AskCardProps} from "./AskCard";
import type {AskSubmission, ChatAsk} from "./askTypes";

const RECEIPT_INPUT: FilesAskInput = {
  accept: ["image", "text", "csv"],
  maxFiles: 2,
  prompt: "Upload the receipt for this expense.",
  submitLabel: "Send receipt",
  title: "Receipt",
};

const RECEIPT_PNG: SelectedFile = {
  mimeType: "image/png",
  name: "receipt.png",
  size: 2048,
  uri: "file:///receipt.png",
};
const ITEMS_TXT: SelectedFile = {
  mimeType: "text/plain",
  name: "items.txt",
  size: 25,
  uri: "file:///items.txt",
};
const REPORT_PDF: SelectedFile = {
  mimeType: "application/pdf",
  name: "report.pdf",
  size: 900,
  uri: "file:///report.pdf",
};

const pendingFiles = (input: FilesAskInput, state: Partial<ChatAsk> = {}): ChatAsk =>
  ({input, kind: "files", status: "pending", toolCallId: "call_receipt", ...state}) as ChatAsk;

const refsFor = (files: SelectedFile[]): AskFileRef[] =>
  files.map((file, index) => ({
    fileId: `upload-${index}`,
    filename: file.name,
    mimeType: file.mimeType,
    size: file.size ?? 0,
  }));

const renderCard = (props: Partial<AskCardProps> & Pick<AskCardProps, "ask">) =>
  renderWithTheme(<AskCard onSubmit={mock(async () => {})} {...props} />);

// Button presses await a haptic call before running onClick, so let those microtasks settle.
const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const isDisabled = (element: {props: {accessibilityState?: {disabled?: boolean}}}): boolean =>
  element.props.accessibilityState?.disabled === true;

type Rendered = ReturnType<typeof renderCard>;

/** The card's picker props. `FilePickerButton.test.tsx` covers how they reach the expo pickers. */
const pickerProps = (rendered: Rendered): FilePickerButtonProps =>
  rendered.UNSAFE_getByType(FilePickerButton).props as FilePickerButtonProps;

/** Picks `files` as the picker would report them. */
const pickFiles = async (rendered: Rendered, files: SelectedFile[]): Promise<void> => {
  await act(async () => {
    pickerProps(rendered).onFilesSelected(files);
  });
  await waitFor(() => {
    for (const file of files) {
      assert.isOk(rendered.getByText(file.name));
    }
  });
};

describe("AskCard files", () => {
  afterEach(() => {
    mock.restore();
  });

  it("shows the question, what it accepts, Choose files, a disabled Submit, and Skip", () => {
    const {getByTestId, getByText} = renderCard({ask: pendingFiles(RECEIPT_INPUT)});

    assert.isOk(getByText("Receipt"));
    assert.isOk(getByText("Upload the receipt for this expense."));
    assert.equal(
      within(getByTestId("ask-card-hint")).getByText(/files/).props.children,
      "Up to 2 files: images, text files or CSV files."
    );
    assert.isOk(within(getByTestId("ask-card-picker")).getByText("Choose files"));
    assert.isTrue(isDisabled(getByTestId("ask-card-submit")));
    assert.isOk(within(getByTestId("ask-card-submit")).getByText("Send receipt"));
    assert.isOk(getByTestId("ask-card-button-skip"));
  });

  it("offers the accepted types, lists the picked files, and sends the refs the host resolves", async () => {
    const onSubmit = mock(async (_submission: AskSubmission) => {});
    const resolveAskFiles = mock(async (files: SelectedFile[]) => refsFor(files));
    const rendered = renderCard({ask: pendingFiles(RECEIPT_INPUT), onSubmit, resolveAskFiles});

    const {documentTypes, includeImages, multiple} = pickerProps(rendered);
    assert.deepEqual(
      {documentTypes, includeImages, multiple},
      {
        documentTypes: [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "text/plain",
          "text/csv",
        ],
        includeImages: true,
        multiple: true,
      }
    );
    await pickFiles(rendered, [RECEIPT_PNG, ITEMS_TXT]);

    assert.isTrue(isDisabled(rendered.getByTestId("ask-card-picker")));
    await press(rendered.getByTestId("ask-card-submit"));

    assert.deepEqual(resolveAskFiles.mock.calls[0]?.[0], [RECEIPT_PNG, ITEMS_TXT]);
    assert.deepEqual(onSubmit.mock.calls[0]?.[0], {
      response: {
        action: "accept",
        content: {
          files: [
            {fileId: "upload-0", filename: "receipt.png", mimeType: "image/png", size: 2048},
            {fileId: "upload-1", filename: "items.txt", mimeType: "text/plain", size: 25},
          ],
        },
      },
      toolCallId: "call_receipt",
    });
  });

  it("offers only the document picker when the ask takes no images", async () => {
    const rendered = renderCard({
      ask: pendingFiles({accept: ["pdf"], maxFiles: 1, prompt: "Upload the PDF."}),
    });

    const {documentTypes, includeImages, multiple} = pickerProps(rendered);
    assert.deepEqual(
      {documentTypes, includeImages, multiple},
      {documentTypes: ["application/pdf"], includeImages: false, multiple: false}
    );
    await pickFiles(rendered, [REPORT_PDF]);

    assert.isFalse(isDisabled(rendered.getByTestId("ask-card-submit")));
  });

  it("explains a file of the wrong type and keeps Submit disabled until it is removed", async () => {
    const rendered = renderCard({ask: pendingFiles(RECEIPT_INPUT)});

    await pickFiles(rendered, [REPORT_PDF]);

    assert.isOk(
      within(rendered.getByTestId("ask-card-errors")).getByText(
        '"report.pdf" is application/pdf, which this ask does not accept.'
      )
    );
    assert.isTrue(isDisabled(rendered.getByTestId("ask-card-submit")));
    await press(rendered.getByLabelText("Remove report.pdf"));
    assert.isNull(rendered.queryByText("report.pdf"));
    assert.isNull(rendered.queryByTestId("ask-card-errors"));
  });

  it("explains a file that is over the size limit", async () => {
    const rendered = renderCard({ask: pendingFiles(RECEIPT_INPUT)});

    await pickFiles(rendered, [{...ITEMS_TXT, size: 11 * 1024 * 1024}]);

    assert.isOk(
      within(rendered.getByTestId("ask-card-errors")).getByText(
        "The file is 11 MB, but the limit is 10 MB."
      )
    );
    assert.isTrue(isDisabled(rendered.getByTestId("ask-card-submit")));
  });

  it("keeps the ask open and says so when the files cannot be prepared", async () => {
    const onSubmit = mock(async (_submission: AskSubmission) => {});
    const resolveAskFiles = mock(async (): Promise<AskFileRef[]> => {
      throw new Error("upload failed");
    });
    const rendered = renderCard({ask: pendingFiles(RECEIPT_INPUT), onSubmit, resolveAskFiles});
    await pickFiles(rendered, [ITEMS_TXT]);

    await press(rendered.getByTestId("ask-card-submit"));

    assert.equal(onSubmit.mock.calls.length, 0);
    assert.isOk(
      within(rendered.getByTestId("ask-card-resolve-error")).getByText(
        "The files could not be sent. Try again, or pick them again."
      )
    );
    assert.isFalse(isDisabled(rendered.getByTestId("ask-card-submit")));
  });

  it("shows the server's errors for the last answer", () => {
    const {getByTestId} = renderCard({
      ask: pendingFiles(RECEIPT_INPUT),
      errors: [
        {
          code: "FILE_NOT_OWNED",
          fix: "Upload the file with POST /files/upload and send the id it returns, or send a data: URL.",
          message: "The file id does not name one of your uploads.",
          path: "content.files[0].fileId",
        },
      ],
    });

    assert.isOk(
      within(getByTestId("ask-card-errors")).getByText(
        "The file id does not name one of your uploads."
      )
    );
  });

  it("clears the server's errors when the picked files change, and shows the next ones", async () => {
    const mismatch = {
      code: "MIME_MISMATCH",
      fix: "Send the file with its real type, or a file that is image/png.",
      message: "The file is declared as image/png, but its bytes are text.",
      path: "content.files[0].mimeType",
    } as const;
    const onSubmit = mock(async (_submission: AskSubmission) => {});
    const ask = pendingFiles(RECEIPT_INPUT);
    const rendered = renderCard({ask, onSubmit});
    await pickFiles(rendered, [RECEIPT_PNG, ITEMS_TXT]);
    rendered.rerender(<AskCard ask={ask} errors={[mismatch]} onSubmit={onSubmit} />);
    assert.isOk(within(rendered.getByTestId("ask-card-errors")).getByText(mismatch.message));

    await press(rendered.getByLabelText("Remove receipt.png"));

    assert.isNull(rendered.queryByTestId("ask-card-errors"));
    assert.isFalse(isDisabled(rendered.getByTestId("ask-card-submit")));

    const tooLarge = {...mismatch, code: "FILE_TOO_LARGE", message: "items.txt is too large."};
    rendered.rerender(<AskCard ask={ask} errors={[tooLarge]} onSubmit={onSubmit} />);
    assert.isOk(within(rendered.getByTestId("ask-card-errors")).getByText(tooLarge.message));

    await pickFiles(rendered, [RECEIPT_PNG]);

    assert.isNull(rendered.queryByTestId("ask-card-errors"));
  });

  it("hides Skip when the ask cannot be declined, and disables the picker without onSubmit", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AskCard ask={pendingFiles({...RECEIPT_INPUT, allowDecline: false})} />
    );

    assert.isNull(queryByTestId("ask-card-button-skip"));
    assert.isTrue(isDisabled(getByTestId("ask-card-picker")));
  });

  it("summarizes an answered ask by the files it sent", () => {
    const {getByTestId} = renderCard({
      ask: pendingFiles(RECEIPT_INPUT, {
        response: {
          action: "accept",
          content: {
            files: [
              {filename: "receipt.png", mimeType: "image/png", size: 2048},
              {filename: "items.txt", mimeType: "text/plain", size: 25},
            ],
          },
        },
        status: "answered",
      }),
    });

    assert.isOk(
      within(getByTestId("ask-card-summary")).getByText("You sent 2 files: receipt.png, items.txt")
    );
  });
});
