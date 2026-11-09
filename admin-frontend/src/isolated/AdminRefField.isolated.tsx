// noExplicitAny: test mocks use loosely typed hook doubles
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {describe, expect, it, mock} from "bun:test";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

mock.module("../AdminObjectPicker", () => ({
  AdminObjectPicker: ({title, refModelName}: {title: string; refModelName: string}) =>
    React.createElement("AdminObjectPicker", {refModelName, testID: "picker", title}),
}));

import {AdminRefField} from "../AdminRefField";

describe("AdminRefField", () => {
  it("renders an AdminObjectPicker passing through key props", () => {
    const {getByTestId} = renderWithTheme(
      <AdminRefField
        baseUrl="/admin"
        errorText="e"
        helperText="h"
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="Owner"
        value="u1"
      />
    );
    expect(getByTestId("picker").props.refModelName).toBe("User");
  });
});
