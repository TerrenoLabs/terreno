import {Box, Button, Modal, type ModalProps, Text, useToast} from "@terreno/ui";
import {useState} from "react";

export const ModalDemo = (props: Partial<ModalProps>) => {
  const [showModal, setShowModal] = useState<boolean>(false);

  return (
    <Box paddingY={1}>
      <Button onClick={() => setShowModal(true)} text="Default Modal" />
      <Modal
        onDismiss={() => setShowModal(false)}
        primaryButtonOnClick={() => setShowModal(false)}
        primaryButtonText="Accept"
        secondaryButtonOnClick={() => setShowModal(false)}
        subtitle="Sub heading"
        text="This is the text of the modal."
        title="Demo modal"
        visible={showModal}
        {...props}
      />
    </Box>
  );
};

export const Modals = () => {
  const [modalToShow, setModalToShow] = useState<string>("");
  const toast = useToast();
  let size = "sm";
  if (modalToShow === "md") {
    size = "md";
  } else if (modalToShow === "lg") {
    size = "lg";
  }
  return (
    <>
      <Box>
        <Box paddingY={1}>
          <Button onClick={() => setModalToShow("default")} text="Default/ Small Modal" />
        </Box>
        <Box paddingY={1}>
          <Button onClick={() => setModalToShow("md")} text="Medium Modal" />
        </Box>
        <Box paddingY={1}>
          <Button onClick={() => setModalToShow("lg")} text="Large Modal" />
        </Box>
        <Box paddingY={1}>
          <Button onClick={() => setModalToShow("secondary")} text="Secondary Button Modal" />
        </Box>
        <Box paddingY={1}>
          <Button onClick={() => setModalToShow("persist")} text="Persist on Background Click" />
        </Box>
      </Box>
      <Modal
        onDismiss={() => setModalToShow("")}
        persistOnBackgroundClick={modalToShow === "persist"}
        primaryButtonOnClick={() => setModalToShow("")}
        primaryButtonText="Accept"
        secondaryButtonOnClick={() => setModalToShow("")}
        secondaryButtonText={modalToShow === "secondary" ? "Secondary" : undefined}
        size={size as "sm" | "md" | "lg"}
        subtitle="Sub heading"
        text="This is the text of the modal."
        title={`${modalToShow} modal`}
        visible={
          modalToShow === "default" ||
          modalToShow === "md" ||
          modalToShow === "lg" ||
          modalToShow === "secondary" ||
          modalToShow === "persist"
        }
      >
        <Box gap={2}>
          <Text>Children inside the modal.</Text>
          <Button
            onClick={() => {
              toast.error("Saved above the modal");
            }}
            text="Show toast"
          />
        </Box>
      </Modal>
    </>
  );
};
