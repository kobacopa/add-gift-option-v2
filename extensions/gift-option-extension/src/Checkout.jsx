import {
  reactExtension,
  Banner,
  BlockStack,
  Checkbox,
  Text,
  useApplyCartLinesChange,
  useCartLines,
  useDeliveryGroups,
} from '@shopify/ui-extensions-react/checkout';
import React, { useEffect, useState, useRef } from 'react';

// 検証環境用: 51625466396991
// 本番環境用: 48402156552416
const GIFT_VARIANT_ID = "gid://shopify/ProductVariant/48402156552416";

export default reactExtension(
  'purchase.checkout.block.render',
  () => <Extension />,
);

function Extension() {
  const applyCartLinesChange = useApplyCartLinesChange();
  const cartLines = useCartLines();
  const deliveryGroups = useDeliveryGroups();

  const [isChecked, setIsChecked] = useState(false);
  // バナーの種類: 'none' | 'changed' | 'nekopos'
  const [bannerType, setBannerType] = useState('none');

  // deliveryGroupsの最新値を保持するRef（クロージャ問題回避用）
  const deliveryGroupsRef = useRef(deliveryGroups);

  // deliveryGroupsが更新されるたびにRefも更新
  useEffect(() => {
    deliveryGroupsRef.current = deliveryGroups;
    console.log("GiftOptionExtension: deliveryGroups updated", deliveryGroups);
  }, [deliveryGroups]);

  // ユーザー操作フラグと、操作前のベースラインタイトルを保持
  const isUserInteractingRef = useRef(false);
  const baselineTitleRef = useRef(null);
  const watchTimeoutRef = useRef(null);
  // チェックを外したかどうかを追跡
  const isUncheckingRef = useRef(false);

  // ネコポスが選択可能かどうかをチェックするヘルパー関数
  const hasNekoposOption = (groups) => {
    if (!groups || groups.length === 0) return false;
    for (const group of groups) {
      if (!group || !group.deliveryOptions) continue;
      for (const option of group.deliveryOptions) {
        if (option.title && option.title.includes('ネコポス')) {
          return true;
        }
      }
    }
    return false;
  };

  // deliveryGroupsから配送方法名を取得するヘルパー関数
  // すべてのグループをチェックし、最初に有効なタイトルを返す
  const getDeliveryTitle = (groups) => {
    if (!groups || groups.length === 0) return null;

    // すべてのグループをチェック
    for (const group of groups) {
      if (!group) continue;
      const selectedDeliveryOption = group.selectedDeliveryOption;
      if (!selectedDeliveryOption) continue;
      const selectedOptionDetail = group.deliveryOptions?.find(
        (option) => option.handle === selectedDeliveryOption.handle
      );
      if (selectedOptionDetail?.title) {
        return selectedOptionDetail.title;
      }
    }
    return null;
  };

  useEffect(() => {
    // カート内のギフト商品の有無を確認し、チェックボックスの状態を同期
    const hasGift = cartLines.some((line) => line.merchandise.id === GIFT_VARIANT_ID);
    setIsChecked(hasGift);
  }, [cartLines]);

  // deliveryGroupsの変更を監視し、ユーザー操作後に比較を実行
  useEffect(() => {
    // ユーザー操作中でない場合は何もしない
    if (!isUserInteractingRef.current) return;

    const currentTitle = getDeliveryTitle(deliveryGroups);
    console.log("GiftOptionExtension: useEffect checking", {
      baseline: baselineTitleRef.current,
      current: currentTitle,
      isInteracting: isUserInteractingRef.current,
      isUnchecking: isUncheckingRef.current
    });

    // currentTitleがnullの場合はまだ更新中なので待機（フラグはリセットしない）
    if (currentTitle === null) {
      console.log("GiftOptionExtension: waiting for valid delivery title...");
      return;
    }

    // チェックを外した場合にネコポスが選択可能かチェック
    if (isUncheckingRef.current && hasNekoposOption(deliveryGroups)) {
      console.log("GiftOptionExtension: Showing Nekopos Banner - ネコポスが選択可能");
      setBannerType('nekopos');
      isUserInteractingRef.current = false;
      isUncheckingRef.current = false;
      if (watchTimeoutRef.current) {
        clearTimeout(watchTimeoutRef.current);
        watchTimeoutRef.current = null;
      }
      return;
    }

    // ベースラインと比較 - 変更があった場合のみバナー表示しリセット
    if (baselineTitleRef.current !== null && baselineTitleRef.current !== currentTitle) {
      console.log("GiftOptionExtension: Showing Banner - title changed from", baselineTitleRef.current, "to", currentTitle);
      setBannerType('changed');
      // 変更を検出したのでフラグをリセット
      isUserInteractingRef.current = false;
      isUncheckingRef.current = false;
      if (watchTimeoutRef.current) {
        clearTimeout(watchTimeoutRef.current);
        watchTimeoutRef.current = null;
      }
    } else {
      // 一致した場合はフラグをリセットせず、監視を継続
      console.log("GiftOptionExtension: Titles match, continuing to watch...");
    }
  }, [deliveryGroups]);

  const handleChange = async (newChecked) => {
    // 既存のタイムアウトをクリア
    if (watchTimeoutRef.current) {
      clearTimeout(watchTimeoutRef.current);
    }

    // チェック操作時点での配送方法名を保存（ベースライン）
    baselineTitleRef.current = getDeliveryTitle(deliveryGroups);
    console.log("GiftOptionExtension: baseline saved", baselineTitleRef.current);

    // ユーザー操作フラグを立てる
    isUserInteractingRef.current = true;

    // バナーは操作のたびにリセット
    setBannerType('none');
    // チェックを外す操作かどうかを記録
    isUncheckingRef.current = !newChecked;
    setIsChecked(newChecked);

    if (newChecked) {
      // Add gift item
      await applyCartLinesChange({
        type: 'addCartLine',
        merchandiseId: GIFT_VARIANT_ID,
        quantity: 1,
      });
    } else {
      // Remove gift item
      const giftLine = cartLines.find((line) => line.merchandise.id === GIFT_VARIANT_ID);
      if (giftLine) {
        await applyCartLinesChange({
          type: 'removeCartLine',
          id: giftLine.id,
          quantity: giftLine.quantity,
        });
      }
    }

    // 3秒後に監視を終了（変更が検出されなかった場合）
    watchTimeoutRef.current = setTimeout(() => {
      console.log("GiftOptionExtension: Watch timeout - ending observation");
      isUserInteractingRef.current = false;
      isUncheckingRef.current = false;
    }, 3000);
  };

  return (
    <BlockStack spacing="base">
      <BlockStack spacing="tight">
        <Checkbox checked={isChecked} onChange={handleChange}>
          ラッピングを希望する(+250円)
        </Checkbox>
        <Text size="small" appearance="subdued">
          ※すべてまとめてラッピングいたします。ラッピングの色は指定できません
        </Text>
        <Text size="small" appearance="subdued">
          ※ネコポスで配送の場合、ラッピング対応できかねますのでご了承ください。
        </Text>
      </BlockStack>
      {bannerType === 'changed' && (
        <Banner status="info" title="配送方法が変更されました">
        </Banner>
      )}
      {bannerType === 'nekopos' && (
        <Banner status="info" title="ネコポスが選択できるようになりました">
        </Banner>
      )}
    </BlockStack>
  );
}