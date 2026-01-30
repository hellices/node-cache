const crypto = require('crypto');

const calculateMD5Hash = async (userID, abtestID) => {
  const md5Sum = crypto.createHash('md5');
  md5Sum.update(userID + abtestID);
  const hashedString = md5Sum.digest('hex');

  const hashMod = parseInt(hashedString, 16) % 10000;
  const hashModFloat = hashMod / 100;

  // console.log('[BucketingService] calculateMD5Hash', { userID, abtestID, hashModFloat });

  return hashModFloat;
};

const decideVariant = async (hashModResult, variantList) => {
  const variants = await Promise.all(variantList); // 모든 variant 병렬 처리
  const selectedVariant = variants.find(
    (x) => x.rangeStart <= hashModResult && x.rangeEnd > hashModResult,
  );

  // if (selectedVariant) {
  //   console.log('[BucketingService] selectedVariant', selectedVariant);
  // } else {
  //   console.log('[BucketingService] selected null', hashModResult, variantList);
  // }

  return selectedVariant || null;
};

const processBucketing = async (abtestID, variantList, request) => {
  const hashResult = await calculateMD5Hash(request.userID, abtestID);

  return decideVariant(hashResult, variantList);
};

const processMeeBucketing = async (userId, meeGroupId) => {
  const hashResult = await calculateMD5Hash(userId, meeGroupId);

  return hashResult;
};

module.exports = {
  processBucketing,
  processMeeBucketing,
  calculateMD5Hash,
  decideVariant,
};
