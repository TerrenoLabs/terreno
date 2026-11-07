import {type ReactElement, useEffect, useRef, useState} from "react";
import type {TextInputInstance} from "react-native";

import type {AddressAutocompleteProps} from "./Common";
import {GOOGLE_PLACES_API_RESTRICTIONS} from "./Constants";
import {TextField} from "./TextField";
import {processAddressComponents} from "./Utilities";

type WindowWithCallbacks = Window & Record<string, unknown>;

const loadGooglePlacesScript = (googleMapsApiKey: string, callbackName: string): Promise<void> => {
  return new Promise<void>((resolve, reject): undefined => {
    if (window.google?.maps?.places) {
      resolve();
      return;
    }
    (window as unknown as WindowWithCallbacks)[callbackName] = (): void => resolve();
    const script: HTMLScriptElement = document.createElement("script");

    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = (): void => {
      reject(new Error("Google Maps script failed to load"));
    };
    document.head.appendChild(script);
    return;
  });
};

export const WebAddressAutocomplete = ({
  disabled,
  googleMapsApiKey,
  includeCounty,
  inputValue,
  handleAddressChange,
  handleAutoCompleteChange,
}: AddressAutocompleteProps): ReactElement => {
  const [scriptLoaded, setScriptLoaded] = useState(true);
  const autocompleteInputRef = useRef<TextInputInstance | null>(null);

  // Load the Google Maps script and initialize the autocomplete.
  useEffect(() => {
    const callbackName = "initAutocomplete";
    if (!googleMapsApiKey) {
      setScriptLoaded(false);
      return;
    }
    loadGooglePlacesScript(googleMapsApiKey, callbackName)
      .then(() => {
        const googleMaps = window.google;
        if (!googleMaps?.maps?.places) {
          throw new Error("Google Maps Places failed to load");
        }
        const autocomplete = new googleMaps.maps.places.Autocomplete(
          autocompleteInputRef.current as unknown as HTMLInputElement | null,
          {
            componentRestrictions: {country: GOOGLE_PLACES_API_RESTRICTIONS.components.country},
            fields: Object.values(GOOGLE_PLACES_API_RESTRICTIONS.fields),
          }
        );
        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          const addressComponents = place?.address_components;
          const formattedAddressObject = processAddressComponents(addressComponents, {
            includeCounty,
          });
          handleAutoCompleteChange(formattedAddressObject);
        });
      })
      .catch((error) => {
        console.warn(error);
        setScriptLoaded(false);
      });
    // Cleanup
    return () => {
      (window as unknown as WindowWithCallbacks)[callbackName] = null;
    };
  }, [googleMapsApiKey, includeCounty, handleAutoCompleteChange]);

  return (
    <TextField
      disabled={disabled}
      inputRef={
        scriptLoaded
          ? (ref: TextInputInstance | null): void => {
              autocompleteInputRef.current = ref;
            }
          : undefined
      }
      onChange={(value): void => {
        handleAddressChange(value);
      }}
      placeholder="Enter an address"
      type="text"
      value={inputValue}
    />
  );
};
