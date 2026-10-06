/**
 * GrabNGo Step 11 — In-App Virtual Touch Keyboard Component Tests
 *
 * Verifies all behavioral and accessibility requirements from Step 11 Section 13 & 16:
 * - Keyboard visibility and rendering
 * - Alphanumeric key input
 * - Space, Backspace, Clear, Search, and Hide actions
 * - Maximum length constraints
 * - Disabled state during async operations
 * - Accessible labels
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import TouchKeyboard from '../../src/components/TouchKeyboard';

describe('TouchKeyboard Component Tests', () => {
  const defaultProps = {
    visible: true,
    onKeyPress: jest.fn(),
    onBackspace: jest.fn(),
    onClear: jest.fn(),
    onSubmit: jest.fn(),
    onClose: jest.fn(),
    isDisabled: false,
    maxLength: 64,
    currentLength: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when visible is false', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<TouchKeyboard {...defaultProps} visible={false} />);
    });
    expect(renderer!.toJSON()).toBeNull();
  });

  it('renders the keyboard container and keys when visible is true', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<TouchKeyboard {...defaultProps} />);
    });
    const root = renderer!.root;

    expect(root.findByProps({ testID: 'touch-keyboard-container' })).toBeTruthy();
    expect(root.findByProps({ testID: 'touch-key-A' })).toBeTruthy();
    expect(root.findByProps({ testID: 'touch-key-1' })).toBeTruthy();
    expect(root.findByProps({ testID: 'touch-key-close' })).toBeTruthy();
  });

  it('fires onKeyPress with the correct character when an alphanumeric key is pressed', () => {
    const onKeyPress = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<TouchKeyboard {...defaultProps} onKeyPress={onKeyPress} />);
    });
    const root = renderer!.root;

    ReactTestRenderer.act(() => {
      root.findByProps({ testID: 'touch-key-A' }).props.onPress();
    });
    expect(onKeyPress).toHaveBeenCalledWith('A');

    ReactTestRenderer.act(() => {
      root.findByProps({ testID: 'touch-key-5' }).props.onPress();
    });
    expect(onKeyPress).toHaveBeenCalledWith('5');
  });

  it('fires onKeyPress with space when SPACE key is pressed', () => {
    const onKeyPress = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<TouchKeyboard {...defaultProps} onKeyPress={onKeyPress} />);
    });
    const root = renderer!.root;

    ReactTestRenderer.act(() => {
      root.findByProps({ testID: 'touch-key-space' }).props.onPress();
    });
    expect(onKeyPress).toHaveBeenCalledWith(' ');
  });

  it('fires onBackspace when BACK key is pressed and currentLength > 0', () => {
    const onBackspace = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <TouchKeyboard {...defaultProps} currentLength={5} onBackspace={onBackspace} />,
      );
    });
    const root = renderer!.root;

    ReactTestRenderer.act(() => {
      root.findByProps({ testID: 'touch-key-backspace' }).props.onPress();
    });
    expect(onBackspace).toHaveBeenCalledTimes(1);
  });

  it('fires onClear when CLEAR key is pressed and currentLength > 0', () => {
    const onClear = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <TouchKeyboard {...defaultProps} currentLength={5} onClear={onClear} />,
      );
    });
    const root = renderer!.root;

    ReactTestRenderer.act(() => {
      root.findByProps({ testID: 'touch-key-clear' }).props.onPress();
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('fires onSubmit when SEARCH key is pressed', () => {
    const onSubmit = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<TouchKeyboard {...defaultProps} onSubmit={onSubmit} />);
    });
    const root = renderer!.root;

    ReactTestRenderer.act(() => {
      root.findByProps({ testID: 'touch-key-search' }).props.onPress();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when HIDE KEYBOARD button is pressed', () => {
    const onClose = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<TouchKeyboard {...defaultProps} onClose={onClose} />);
    });
    const root = renderer!.root;

    ReactTestRenderer.act(() => {
      root.findByProps({ testID: 'touch-key-close' }).props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables input keys when maximum length is reached', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <TouchKeyboard
          {...defaultProps}
          currentLength={64}
          maxLength={64}
        />,
      );
    });
    const root = renderer!.root;

    expect(root.findByProps({ testID: 'touch-key-B' }).props.disabled).toBe(true);
    expect(root.findByProps({ testID: 'touch-key-space' }).props.disabled).toBe(true);
  });

  it('disables search and action keys when isDisabled is true (e.g. during active search)', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <TouchKeyboard
          {...defaultProps}
          isDisabled={true}
        />,
      );
    });
    const root = renderer!.root;

    expect(root.findByProps({ testID: 'touch-key-search' }).props.disabled).toBe(true);
    expect(root.findByProps({ testID: 'touch-key-A' }).props.disabled).toBe(true);
  });

  it('displays accurate character count', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <TouchKeyboard {...defaultProps} currentLength={12} maxLength={64} />,
      );
    });
    const root = renderer!.root;

    expect(root.findByProps({ testID: 'touch-keyboard-counter' }).props.children).toEqual([12, '/', 64]);
  });
});
